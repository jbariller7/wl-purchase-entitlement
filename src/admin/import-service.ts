import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import type { Product } from "../domain/model.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { sha256 } from "../infrastructure/ids.js";
import type { AdminActor } from "./audit.js";
import { HttpError } from "../http/auth.js";
import { chapterMigrationGrant, isLegacyChapterProduct } from "../domain/legacy-chapter-migration.js";
import { safeErrorMessage } from "../infrastructure/safe-error.js";

export type AdminImportKind =
  | "mobile_lifetime"
  | "mobile_polyglot_permanent"
  | "premium_lifetime_pass"
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
  mobilePlatform?: "android" | "ios";
  startsAt?: string;
  endsAt?: string;
  note: string;
}

interface NormalizedImportRow extends AdminImportRow {
  email: string;
  startsAt: string;
}

interface ImportJob {
  actorUid: string;
  state: string;
  expiresAt: string;
  createdAt: string;
  confirmationPhrase: string;
  rows: NormalizedImportRow[];
  processingAt?: string;
  confirmedAt?: string;
  leaseOwner?: string | null;
  leaseExpiresAt?: string | null;
  processed?: number;
  applied?: number;
  pending?: number;
  lastError?: string | null;
  result?: { records: number; applied: number; pending: number };
}

function importProgress(previewId: string, job: ImportJob) {
  return {
    previewId, state: job.state, records: job.rows.length,
    progressKnown: job.state === "complete" || typeof job.processed === "number" || job.state === "preview",
    processed: job.state === "complete" ? job.rows.length : job.processed ?? 0,
    applied: job.result?.applied ?? job.applied ?? 0,
    pending: job.result?.pending ?? job.pending ?? 0,
    createdAt: job.createdAt, expiresAt: job.expiresAt,
    confirmationPhrase: job.confirmationPhrase,
    started: Boolean(job.confirmedAt || job.processingAt || job.state !== "preview"),
    lastError: job.lastError ?? null
  };
}

const productByKind: Partial<Record<AdminImportKind, Product>> = {
  mobile_lifetime: "mobile_full_lifetime",
  mobile_polyglot_permanent: "mobile_polyglot_permanent",
  premium_lifetime_pass: "premium_lifetime_pass",
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, `Invalid email: ${row.email}`);
  if (!row.externalId.trim() || row.externalId.length > 200) throw new HttpError(400, `External ID is missing or too long for ${email}.`);
  if (row.note.trim().length < 5) throw new HttpError(400, `Import note is too short for ${email}.`);
  const product = productByKind[row.kind];
  if ((row.kind === "mobile_polyglot_permanent" || row.kind === "premium_lifetime_pass" || (product && isLegacyChapterProduct(product))) && !row.mobilePlatform) {
    throw new HttpError(400, `Choose Android or iOS for ${email}.`);
  }
  const startsAt = row.startsAt ? new Date(row.startsAt) : now;
  if (!Number.isFinite(startsAt.getTime())) throw new HttpError(400, `Invalid startsAt for ${email}.`);
  if (row.endsAt) {
    const endsAt = new Date(row.endsAt);
    if (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new HttpError(400, `Invalid endsAt for ${email}.`);
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

export function normalizeImportRows(rows: AdminImportRow[], now: Date): NormalizedImportRow[] {
  if (!rows.length || rows.length > 500) throw new HttpError(400, "Import must contain between 1 and 500 records.");
  const normalized = rows.map((row) => normalizeRow(row, now));
  const externalIds = new Set<string>();
  for (const row of normalized) {
    if (externalIds.has(row.externalId)) throw new HttpError(400, `Duplicate external ID in this file: ${row.externalId}`);
    externalIds.add(row.externalId);
  }
  return normalized;
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
    const rows = normalizeImportRows(input.rows, input.now);
    const emails = [...new Set(rows.map((row) => row.email))];
    const uids = new Map<string, string>();
    // Firebase supports 100 identifiers per lookup; avoid hundreds of parallel requests.
    for (let offset = 0; offset < emails.length; offset += 100) {
      const result = await this.auth.getUsers(emails.slice(offset, offset + 100).map((email) => ({ email })));
      for (const user of result.users) if (user.email) uids.set(normalizedEmail(user.email), user.uid);
    }
    const resolutions = rows.map((row) => ({ row, uid: uids.get(row.email) }));
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
    const originalGrant = {
      id: "",
      uid,
      provider: "admin",
      providerTransactionId: `import:${row.externalId}`,
      product,
      state: "active",
      startsAt: row.startsAt,
      ...(row.endsAt ? { endsAt: row.endsAt } : {}),
      metadata: {
        importExternalId: row.externalId,
        importNote: row.note,
        importedBy: actorUid,
        ...(row.mobilePlatform ? (product === "premium_lifetime_pass"
          ? { primaryMobilePlatform: row.mobilePlatform }
          : { mobilePlatform: row.mobilePlatform }) : {})
      }
    } satisfies import("../domain/model.js").LedgerGrant;
    const source = { id: `admin-import:${row.externalId}`, created: Math.floor(Date.parse(row.startsAt) / 1000) };
    await this.store.upsertGrant(originalGrant, source);
    const migration = chapterMigrationGrant(originalGrant);
    if (migration) await this.store.upsertGrant(migration, { ...source, id: `${source.id}:chapter-full-upgrade` });
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

  async recent(actor: AdminActor): Promise<Record<string, unknown>> {
    const snapshot = await this.db.collection("adminImportPreviews").orderBy("createdAt", "desc").limit(20).get();
    return { imports: snapshot.docs.filter((doc) => doc.data().actorUid === actor.uid)
      .map((doc) => importProgress(doc.id, doc.data() as ImportJob)) };
  }

  async status(actor: AdminActor, previewId: string): Promise<Record<string, unknown>> {
    const snapshot = await this.db.collection("adminImportPreviews").doc(previewId).get();
    if (!snapshot.exists) throw new HttpError(404, "Import not found.");
    const job = snapshot.data() as ImportJob;
    if (job.actorUid !== actor.uid) throw new HttpError(403, "This import belongs to another administrator.");
    return importProgress(previewId, job);
  }

  async commit(input: { actor: AdminActor; previewId: string; confirmationPhrase: string; now: Date }): Promise<Record<string, unknown>> {
    const ref = this.db.collection("adminImportPreviews").doc(input.previewId);
    const leaseOwner = randomUUID();
    const started = Date.now();
    const currentTime = () => new Date(input.now.getTime() + Date.now() - started);
    const preview = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new HttpError(404, "Import preview not found.");
      const data = snapshot.data() as ImportJob;
      if (data.actorUid !== input.actor.uid) throw new HttpError(403, "This import preview belongs to another administrator.");
      if (data.state === "complete") return data;
      if (input.confirmationPhrase.trim() !== data.confirmationPhrase) throw new HttpError(400, "The confirmation phrase does not match.");
      // Expiry limits unconfirmed previews, never recovery of an approved import.
      if (data.state === "preview" && !data.confirmedAt && Date.parse(data.expiresAt) <= input.now.getTime()) {
        throw new HttpError(410, "Import preview expired. Upload the file again.");
      }
      // Older versions had no lease or cursor. Their stable external IDs allow safe replay,
      // but wait for any original invocation to finish before taking over.
      const leaseUntil = data.leaseExpiresAt ? Date.parse(data.leaseExpiresAt)
        : data.leaseOwner === undefined && data.state === "processing" && data.processingAt
          ? Date.parse(data.processingAt) + 120_000 : 0;
      if (leaseUntil > input.now.getTime()) return data;
      const claimed: ImportJob = { ...data, state: "processing", leaseOwner,
        leaseExpiresAt: new Date(currentTime().getTime() + 120_000).toISOString(),
        confirmedAt: data.confirmedAt ?? data.processingAt ?? input.now.toISOString(),
        processingAt: currentTime().toISOString(), lastError: null,
        processed: data.processed ?? 0, applied: data.applied ?? 0, pending: data.pending ?? 0 };
      transaction.set(ref, claimed);
      return claimed;
    });
    if (preview.state === "complete") return importProgress(input.previewId, preview);
    if (preview.leaseOwner !== leaseOwner) return { ...importProgress(input.previewId, preview), busy: true, retryAfterMs: 3000 };
    let job = preview;
    try {
      // Bound each HTTP request, and checkpoint every row, including before a hard timeout.
      for (let count = 0; count < 5 && Date.now() - started < 8_000 && (job.processed ?? 0) < job.rows.length; count++) {
        const index = job.processed ?? 0;
        const row = job.rows[index]!;
        const uid = await userUidByEmail(this.auth, row.email);
        if (uid) await this.applyRow(uid, row, input.actor.uid, currentTime());
        else await this.holdPending(row, input.actor.uid, currentTime());
        job = await this.db.runTransaction(async (transaction) => {
          const data = (await transaction.get(ref)).data() as ImportJob;
          if (data.leaseOwner !== leaseOwner || (data.processed ?? 0) !== index) throw new HttpError(409, "Import continued in another session. Refresh its progress.");
          const next = { ...data, processed: index + 1, applied: (data.applied ?? 0) + (uid ? 1 : 0), pending: (data.pending ?? 0) + (uid ? 0 : 1) };
          transaction.update(ref, { processed: next.processed, applied: next.applied, pending: next.pending });
          return next;
        });
      }
      job = await this.db.runTransaction(async (transaction) => {
        const data = (await transaction.get(ref)).data() as ImportJob;
        if (data.leaseOwner !== leaseOwner) throw new HttpError(409, "Import continued in another session. Refresh its progress.");
        const complete = data.processed === data.rows.length;
        const result = { records: data.rows.length, applied: data.applied ?? 0, pending: data.pending ?? 0 };
        const update = { state: complete ? "complete" : "processing", leaseOwner: null, leaseExpiresAt: null,
          ...(complete ? { result, completedAt: currentTime().toISOString() } : {}) };
        transaction.update(ref, update);
        if (complete) {
          const audit = this.db.collection("adminAudit").doc(`import-${input.previewId}`);
          transaction.set(audit, { id: audit.id, actorUid: input.actor.uid, actorEmail: input.actor.email,
            action: "import.commit", targetType: "import", targetId: input.previewId,
            summary: `Imported ${data.rows.length} purchase records`, metadata: result, createdAt: currentTime().toISOString() });
        }
        return { ...data, ...update };
      });
      return importProgress(input.previewId, job);
    } catch (error) {
      await this.db.runTransaction(async (transaction) => {
        const data = (await transaction.get(ref)).data() as ImportJob;
        if (data.leaseOwner === leaseOwner) transaction.update(ref, { state: "failed", leaseOwner: null, leaseExpiresAt: null,
          failedAt: currentTime().toISOString(), lastError: safeErrorMessage(error, "Unknown error") });
      }).catch(() => undefined);
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
      await ref.update({ state: "failed", lastError: safeErrorMessage(error, "Unknown error") }).catch(() => undefined);
      throw error;
    }
  }
}
