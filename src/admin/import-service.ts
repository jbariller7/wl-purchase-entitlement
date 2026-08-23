import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type { Product } from "../domain/model.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { sha256 } from "../infrastructure/ids.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";

export type AdminImportKind =
  | "mobile_lifetime"
  | "legacy_mobile_full"
  | "legacy_chapter_1"
  | "legacy_chapter_2"
  | "legacy_chapter_3"
  | "legacy_chapter_4"
  | "desktop_discount";

export interface AdminImportRow {
  email: string;
  kind: AdminImportKind;
  externalId: string;
  startsAt?: string;
  endsAt?: string;
  note: string;
}

interface NormalizedImportRow extends AdminImportRow {
  email: string;
  startsAt: string;
}

const productByKind: Partial<Record<AdminImportKind, Product>> = {
  mobile_lifetime: "mobile_full_lifetime",
  legacy_mobile_full: "legacy_mobile_full",
  legacy_chapter_1: "legacy_chapter_1",
  legacy_chapter_2: "legacy_chapter_2",
  legacy_chapter_3: "legacy_chapter_3",
  legacy_chapter_4: "legacy_chapter_4"
};

function normalizedEmail(email: string): string { return email.trim().toLowerCase(); }
function pendingId(email: string): string { return sha256(normalizedEmail(email)); }

function normalizeRow(row: AdminImportRow, now: Date): NormalizedImportRow {
  const email = normalizedEmail(row.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid email: ${row.email}`);
  if (!row.externalId.trim() || row.externalId.length > 200) throw new Error(`External ID is missing or too long for ${email}.`);
  if (row.note.trim().length < 5) throw new Error(`Import note is too short for ${email}.`);
  const startsAt = row.startsAt ? new Date(row.startsAt) : now;
  if (!Number.isFinite(startsAt.getTime())) throw new Error(`Invalid startsAt for ${email}.`);
  if (row.endsAt) {
    const endsAt = new Date(row.endsAt);
    if (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new Error(`Invalid endsAt for ${email}.`);
  }
  return {
    ...row,
    email,
    externalId: row.externalId.trim(),
    note: row.note.trim(),
    startsAt: startsAt.toISOString(),
    ...(row.endsAt ? { endsAt: new Date(row.endsAt).toISOString() } : {})
  };
}

async function userUidByEmail(auth: Auth, email: string): Promise<string | undefined> {
  try { return (await auth.getUserByEmail(email)).uid; }
  catch (error) {
    if ((error as { code?: string }).code === "auth/user-not-found") return undefined;
    throw error;
  }
}

export class AdminImportService {
  private readonly store: EntitlementStore;

  constructor(private readonly db: Firestore, private readonly auth: Auth) {
    this.store = new EntitlementStore(db);
  }

  async preview(input: { actor: AdminActor; rows: AdminImportRow[]; now: Date }): Promise<Record<string, unknown>> {
    if (!input.rows.length || input.rows.length > 500) throw new Error("Import must contain between 1 and 500 records.");
    const rows = input.rows.map((row) => normalizeRow(row, input.now));
    const externalIds = new Set<string>();
    for (const row of rows) {
      if (externalIds.has(row.externalId)) throw new Error(`Duplicate external ID in this file: ${row.externalId}`);
      externalIds.add(row.externalId);
    }
    const resolutions = await Promise.all(rows.map(async (row) => ({ row, uid: await userUidByEmail(this.auth, row.email) })));
    const previewId = randomUUID();
    const expiresAt = new Date(input.now.getTime() + 30 * 60 * 1000);
    const confirmationPhrase = `IMPORT ${rows.length} RECORD${rows.length === 1 ? "" : "S"}`;
    await this.db.collection("adminImportPreviews").doc(previewId).create({
      id: previewId,
      actorUid: input.actor.uid,
      rows,
      state: "preview",
      createdAt: input.now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      confirmationPhrase,
      batchHash: sha256(JSON.stringify(rows))
    });
    return {
      previewId,
      confirmationPhrase,
      expiresAt: expiresAt.toISOString(),
      summary: {
        records: rows.length,
        existingAccounts: resolutions.filter((item) => item.uid).length,
        pendingFirstSignIn: resolutions.filter((item) => !item.uid).length,
        discounts: rows.filter((row) => row.kind === "desktop_discount").length,
        entitlements: rows.filter((row) => row.kind !== "desktop_discount").length
      },
      rows: resolutions.map(({ row, uid }) => ({ ...row, action: uid ? "apply_to_existing_account" : "hold_until_verified_first_sign_in", uid: uid ?? null })),
      warnings: [
        "Unknown emails are not used to create passwordless Firebase accounts. Their records remain pending until that exact verified email signs in with Google, Apple or email link.",
        "Importing a desktop purchase enables only the private discount; it never unlocks mobile access by itself."
      ]
    };
  }

  private async applyRow(uid: string, row: NormalizedImportRow, actorUid: string, now: Date): Promise<void> {
    if (row.kind === "desktop_discount") {
      const ref = this.db.collection("legacyDiscountClaims").doc(uid);
      await this.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const current = snapshot.data() as { verifiedDesktopTransactionIds?: string[]; redeemedAt?: string } | undefined;
        const ids = new Set(current?.verifiedDesktopTransactionIds ?? []);
        ids.add(row.externalId);
        transaction.set(ref, {
          uid,
          verifiedDesktopTransactionIds: [...ids].sort(),
          ...(current?.redeemedAt ? { redeemedAt: current.redeemedAt } : {}),
          updatedAt: now.toISOString()
        }, { merge: true });
      });
      return;
    }
    const product = productByKind[row.kind];
    if (!product) throw new Error(`Unsupported import kind ${row.kind}.`);
    await this.store.upsertGrant({
      id: "",
      uid,
      provider: "admin",
      providerTransactionId: `import:${row.externalId}`,
      product,
      state: "active",
      startsAt: row.startsAt,
      ...(row.endsAt ? { endsAt: row.endsAt } : {}),
      metadata: { importExternalId: row.externalId, importNote: row.note, importedBy: actorUid }
    }, { id: `admin-import:${row.externalId}`, created: Math.floor(Date.parse(row.startsAt) / 1000) });
  }

  private async holdPending(row: NormalizedImportRow, actorUid: string, now: Date): Promise<void> {
    const ref = this.db.collection("pendingImports").doc(pendingId(row.email));
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.data() as { rows?: NormalizedImportRow[]; claimedByUid?: string } | undefined;
      if (current?.claimedByUid) throw new Error(`A pending import for ${row.email} was already claimed; refresh the account lookup.`);
      const rows = current?.rows ?? [];
      const deduped = [...rows.filter((existing) => existing.externalId !== row.externalId), row];
      transaction.set(ref, {
        email: row.email,
        rows: deduped,
        state: "pending",
        importedBy: actorUid,
        updatedAt: now.toISOString(),
        ...(snapshot.exists ? {} : { createdAt: now.toISOString() })
      });
    });
  }

  async commit(input: { actor: AdminActor; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    const ref = this.db.collection("adminImportPreviews").doc(input.previewId);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Import preview not found.");
      const data = snapshot.data() as { actorUid: string; state: string; expiresAt: string; confirmationPhrase: string; rows: NormalizedImportRow[]; result?: Record<string, unknown> };
      if (data.actorUid !== input.actor.uid) throw new Error("This import preview belongs to another administrator.");
      if (data.state === "complete") return data;
      if (data.state !== "preview" && data.state !== "failed") throw new Error("This import is already processing.");
      if (Date.parse(data.expiresAt) <= input.now.getTime()) throw new Error("Import preview expired. Upload the file again.");
      if (input.confirmationPhrase.trim() !== data.confirmationPhrase) throw new Error("The confirmation phrase does not match.");
      transaction.update(ref, { state: "processing", processingAt: input.now.toISOString(), lastError: null });
      return data;
    });
    if (preview.state === "complete" && preview.result) return preview.result;
    let applied = 0;
    let pending = 0;
    try {
      for (const row of preview.rows) {
        const uid = await userUidByEmail(this.auth, row.email);
        if (uid) { await this.applyRow(uid, row, input.actor.uid, input.now); applied += 1; }
        else { await this.holdPending(row, input.actor.uid, input.now); pending += 1; }
      }
      const result = { records: preview.rows.length, applied, pending };
      await ref.update({ state: "complete", completedAt: new Date().toISOString(), result });
      await recordAdminAudit({
        db: this.db, actor: input.actor, action: "import.commit", targetType: "import", targetId: input.previewId,
        summary: `Imported ${preview.rows.length} purchase records`, metadata: result, now: input.now
      });
      return result;
    } catch (error) {
      await ref.update({ state: "failed", failedAt: new Date().toISOString(), lastError: error instanceof Error ? error.message : "Unknown error" }).catch(() => undefined);
      throw error;
    }
  }

  async claimPendingForVerifiedUser(input: { uid: string; email: string; now: Date }): Promise<number> {
    const email = normalizedEmail(input.email);
    const ref = this.db.collection("pendingImports").doc(pendingId(email));
    const rows = await this.db.runTransaction(async (transaction): Promise<NormalizedImportRow[]> => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return [];
      const data = snapshot.data() as { email: string; state: string; rows: NormalizedImportRow[]; claimedByUid?: string };
      if (data.email !== email) throw new Error("Pending import email hash collision.");
      if (data.claimedByUid && data.claimedByUid !== input.uid) throw new Error("Pending import is already linked to another user.");
      if (data.state === "claimed") return [];
      transaction.update(ref, { state: "processing", claimedByUid: input.uid, processingAt: input.now.toISOString() });
      return data.rows;
    });
    if (!rows.length) return 0;
    try {
      for (const row of rows) await this.applyRow(input.uid, row, "pending-import-claim", input.now);
      await ref.update({ state: "claimed", claimedAt: new Date().toISOString(), claimedByUid: input.uid });
      return rows.length;
    } catch (error) {
      await ref.update({ state: "failed", lastError: error instanceof Error ? error.message : "Unknown error" }).catch(() => undefined);
      throw error;
    }
  }
}
