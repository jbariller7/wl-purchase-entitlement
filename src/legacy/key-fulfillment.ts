import type { Firestore } from "firebase-admin/firestore";
import { google } from "googleapis";
import type { LegacyOrder } from "../domain/model.js";
import { stableDocumentId } from "../infrastructure/ids.js";

interface KeyRecord {
  key: string;
  sheetTab: string;
  rowNumber: number;
  state: "available" | "assigned";
  assignedOrderId?: string;
}

interface Fulfillment {
  orderId: string;
  keys: Array<{ key: string; sheetTab: string; rowNumber: number }>;
  createdAt: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} for legacy key fulfillment.`);
  return value;
}

async function sheetsClient() {
  const auth = new google.auth.JWT({
    email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });
  return google.sheets({ version: "v4", auth });
}

export class LegacyKeyFulfillmentService {
  constructor(private readonly db: Firestore) {}

  private async allocate(order: LegacyOrder, sheetTab: string, now: Date): Promise<Fulfillment> {
    const fulfillmentRef = this.db.collection("legacyFulfillments").doc(order.id);
    return this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(fulfillmentRef);
      if (existing.exists) return existing.data() as Fulfillment;
      const availableQuery = this.db.collection("legacyKeys")
        .where("sheetTab", "==", sheetTab)
        .where("state", "==", "available")
        .limit(order.quantity);
      const available = await transaction.get(availableQuery);
      if (available.size < order.quantity) {
        throw new Error(`Only ${available.size} key(s) remain in ${sheetTab}; ${order.quantity} required.`);
      }
      const keys = available.docs.map((doc) => {
        const data = doc.data() as KeyRecord;
        transaction.update(doc.ref, {
          state: "assigned",
          assignedOrderId: order.id,
          assignedEmail: order.buyerEmail,
          assignedAt: now.toISOString()
        });
        return { key: data.key, sheetTab: data.sheetTab, rowNumber: data.rowNumber };
      });
      const fulfillment: Fulfillment = { orderId: order.id, keys, createdAt: now.toISOString() };
      transaction.create(fulfillmentRef, fulfillment);
      return fulfillment;
    });
  }

  private async mirrorAssignments(order: LegacyOrder, fulfillment: Fulfillment): Promise<void> {
    const sheets = await sheetsClient();
    const when = fulfillment.createdAt;
    await Promise.all(fulfillment.keys.map((record) => sheets.spreadsheets.values.update({
      spreadsheetId: required("GOOGLE_SHEET_ID"),
      range: `'${record.sheetTab.replace(/'/g, "''")}'!B${record.rowNumber}:E${record.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[order.buyerEmail, when, order.stripeCheckoutSessionId, order.paymentLinkId ?? ""]]
      }
    })));
  }

  private groupsFor(order: LegacyOrder): string[] {
    const list = (name: string) => (process.env[name] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    return [...new Set([
      ...list("ML_GROUPS_ALL"),
      ...(order.playMode === "STEAM" ? list("ML_GROUPS_POLY_STEAM") : list("ML_GROUPS_POLY_ITCH"))
    ])];
  }

  private async syncMailerLite(order: LegacyOrder, fulfillment: Fulfillment): Promise<void> {
    const token = required("MAILERLITE_API_TOKEN");
    const primaryField = order.playMode === "STEAM"
      ? process.env.ML_FIELD_STEAM_KEY || "steam_key"
      : process.env.ML_FIELD_ITCH_KEY || "itch_key";
    const extraField = order.playMode === "STEAM"
      ? process.env.ML_FIELD_EXTRA_STEAM_KEY || "extra_steam_key"
      : process.env.ML_FIELD_EXTRA_ITCH_KEY || "extra_itch_link";
    const fields: Record<string, string> = {};
    if (fulfillment.keys[0]) fields[primaryField] = fulfillment.keys[0].key;
    if (fulfillment.keys[1]) fields[extraField] = fulfillment.keys[1].key;
    const response = await fetch("https://connect.mailerlite.com/api/subscribers", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({
        email: order.buyerEmail,
        fields,
        groups: this.groupsFor(order)
      }),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MailerLite upsert failed (${response.status}): ${body.slice(0, 300)}`);
    }
  }

  async fulfill(order: LegacyOrder, sheetTab: string, now: Date): Promise<{ keyCount: number }> {
    if (!sheetTab) throw new Error(`No key-inventory sheet is configured for ${order.productCode}.`);
    const fulfillment = await this.allocate(order, sheetTab, now);
    await this.mirrorAssignments(order, fulfillment);
    await this.syncMailerLite(order, fulfillment);
    await this.db.collection("legacyFulfillments").doc(order.id).set({
      mirroredToSheetAt: now.toISOString(),
      syncedToMailerLiteAt: now.toISOString()
    }, { merge: true });
    return { keyCount: fulfillment.keys.length };
  }
}

export function legacyKeyDocumentId(sheetTab: string, key: string): string {
  return stableDocumentId("legacy-key", `${sheetTab}:${key}`);
}
