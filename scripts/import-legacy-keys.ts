import { google } from "googleapis";
import { firestore } from "../src/infrastructure/firebase.js";
import { legacyKeyDocumentId } from "../src/legacy/key-fulfillment.js";
import { SHEET_TAB_BY_PRODUCT } from "../src/legacy/catalog.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const db = firestore();
  const existing = await db.collection("legacyKeys").limit(1).get();
  if (!existing.empty) throw new Error("legacyKeys is not empty. Refusing a destructive re-import.");
  const auth = new google.auth.JWT({
    email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });
  const sheets = google.sheets({ version: "v4", auth });
  const tabs = [...new Set(Object.values(SHEET_TAB_BY_PRODUCT))];
  const inventory: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const sheetTab of tabs) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: required("GOOGLE_SHEET_ID"),
      range: `'${sheetTab.replace(/'/g, "''")}'!A2:F`
    });
    for (const [index, row] of (response.data.values ?? []).entries()) {
      const key = String(row[0] ?? "").trim();
      if (!key) continue;
      const assignedEmail = String(row[1] ?? "").trim();
      const assignedOrderId = String(row[3] ?? "").trim();
      inventory.push({
        id: legacyKeyDocumentId(sheetTab, key),
        data: {
          key,
          sheetTab,
          rowNumber: index + 2,
          state: assignedEmail ? "assigned" : "available",
          ...(assignedEmail ? { assignedEmail } : {}),
          ...(assignedOrderId ? { assignedOrderId } : {}),
          importedAt: new Date().toISOString()
        }
      });
    }
  }
  const available = inventory.filter((record) => record.data.state === "available").length;
  console.log(`Inventory: ${inventory.length} keys (${available} available, ${inventory.length - available} assigned).`);
  if (!commit) {
    console.log("Dry run only. Re-run with --commit after checking the counts.");
    return;
  }
  for (let offset = 0; offset < inventory.length; offset += 400) {
    const batch = db.batch();
    for (const record of inventory.slice(offset, offset + 400)) {
      batch.create(db.collection("legacyKeys").doc(record.id), record.data);
    }
    await batch.commit();
  }
  console.log(`Imported ${inventory.length} keys transaction-safely.`);
}

await main();
