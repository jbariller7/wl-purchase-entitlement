import type { Auth } from "firebase-admin/auth";
import { accountEmails } from "../identity/account-email.js";
import { FieldPath, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { projectEntitlements } from "../domain/entitlement-projector.js";
import { PRODUCT_CAPABILITIES } from "../domain/catalog.js";
import type { EffectiveEntitlements, LedgerGrant, Product } from "../domain/model.js";

export const directoryQuery = z.object({
  source: z.enum(["registered", "pending", "purchases"]).default("registered"),
  access: z.enum(["all", "premium_lifetime", "permanent", "subscription", "legacy", "none"]).default("all"),
  cloud: z.enum(["all", "yes", "no"]).default("all"),
  platform: z.enum(["all", "android", "ios", "desktop"]).default("all"),
  status: z.enum(["all", "enabled", "disabled"]).default("all"),
  q: z.string().trim().max(320).default(""),
  cursor: z.string().min(1).max(4096).optional()
}).strict();
type Filters = z.infer<typeof directoryQuery>;
export function matchesDirectory(row: { email: string | null; emails?: string[]; uid: string | null; name?: string | null; disabled: boolean; entitlements: EffectiveEntitlements }, f: Filters) {
  const e = row.entitlements;
  return (!f.q || `${row.email || ""} ${(row.emails || []).join(" ")} ${row.uid || ""} ${row.name || ""}`.toLowerCase().includes(f.q.toLowerCase())) &&
    (f.access === "all" || e.accessKind === f.access) &&
    (f.cloud === "all" || e.cloudSave === (f.cloud === "yes")) &&
    (f.platform === "all" || (f.platform === "desktop" ? e.pcMacAccess : e.mobilePlatforms.includes(f.platform))) &&
    (f.status === "all" || row.disabled === (f.status === "disabled"));
}
function summary(e: EffectiveEntitlements) {
  return { accessKind: e.accessKind, cloudSave: e.cloudSave, mobilePlatforms: e.mobilePlatforms, pcMacAccess: e.pcMacAccess, subscriptionState: e.subscriptionState };
}
export async function accountDirectory(db: Firestore, auth: Auth, f: Filters, now = new Date()) {
  const store = new EntitlementStore(db);
  const rows = [];
  let scanned = 0;
  let nextCursor: string | null = null;
  if (f.source === "registered") {
    const page = await auth.listUsers(100, f.cursor);
    scanned = page.users.length;
    nextCursor = page.pageToken || null;
    // Bound parallel reads. Compute from current grants without writing snapshots.
    for (let i = 0; i < page.users.length; i += 10) {
      const batch = await Promise.all(page.users.slice(i, i + 10).map(async user => {
        const entitlements = projectEntitlements(user.uid, await store.grantsForUid(user.uid), now, 0);
        const emails = accountEmails(user);
        const row = { uid: user.uid, email: emails[0] || null, emails, name: user.displayName || null, disabled: user.disabled, entitlements };
        return matchesDirectory(row, f) ? { ...row, entitlements: summary(entitlements), emailVerified: user.emailVerified, createdAt: user.metadata.creationTime, lastSignInAt: user.metadata.lastSignInTime || null } : null;
      }));
      rows.push(...batch.filter(row => row !== null));
    }
  } else if (f.source === "purchases") {
    let query = db.collection("websiteOrders").orderBy(FieldPath.documentId()).limit(101);
    if (f.cursor) query = query.startAfter(f.cursor);
    const page = await query.get();
    const docs = page.docs.slice(0, 100);
    scanned = docs.length;
    nextCursor = page.docs.length > 100 ? docs.at(-1)!.id : null;
    const products: Record<string, Product> = { premium: "premium_lifetime_pass", mobile_permanent: "mobile_polyglot_permanent", mobile_monthly: "mobile_full_monthly", single: "desktop_language", polyglot: "desktop_polyglot" };
    for (let i = 0; i < docs.length; i += 10) {
      const batch = await Promise.all(docs.slice(i, i + 10).map(async doc => {
      const data = doc.data();
      const product = products[data.request?.offer];
      if (!product) return null;
      const uid = typeof data.claimedByUid === "string" ? data.claimedByUid : null;
      const account = uid ? await auth.getUser(uid).catch((error: {code?: string}) => { if (error.code === "auth/user-not-found") return null; throw error; }) : null;
      const grants: LedgerGrant[] = uid ? await store.grantsForUid(uid) : [{ id: "pending-purchase", uid: "pending", provider: "stripe", providerTransactionId: doc.id, product, state: "active", startsAt: new Date(data.sourceEventCreated * 1000).toISOString(), metadata: { mobilePlatform: data.request.mobilePlatform || null } }];
      const entitlements = projectEntitlements(uid || "pending", grants, now, 0);
      const row = { uid, email: typeof data.buyerEmail === "string" ? data.buyerEmail : null, name: account?.displayName || null, disabled: account?.disabled || false, entitlements };
      return matchesDirectory(row, f) ? { ...row, entitlements: summary(entitlements), emailVerified: account?.emailVerified || false, createdAt: data.createdAt || null, lastSignInAt: account?.metadata.lastSignInTime || null, purchase: { sessionId: doc.id, offer: data.request.offer, claimed: Boolean(uid) } } : null;
      }));
      rows.push(...batch.filter(row => row !== null));
    }
  } else {
    // Document-ID pagination needs no composite index and also handles old claimed records.
    let query = db.collection("pendingImports").orderBy(FieldPath.documentId()).limit(101);
    if (f.cursor) query = query.startAfter(f.cursor);
    const page = await query.get();
    const docs = page.docs.slice(0, 100);
    scanned = docs.length;
    nextCursor = page.docs.length > 100 ? docs.at(-1)!.id : null;
    for (const doc of docs) {
      const data = doc.data();
      if (data.state !== "pending" || data.claimedByUid) continue;
      const grants: LedgerGrant[] = (Array.isArray(data.rows) ? data.rows : []).flatMap((item, index) => {
        const product = item.kind === "mobile_lifetime" ? "mobile_full_lifetime" : item.kind;
        if (!Object.hasOwn(PRODUCT_CAPABILITIES, product)) return [];
        return [{ id: String(index), uid: "pending", provider: "admin", providerTransactionId: String(index), product: product as Product, state: "active", startsAt: item.startsAt, ...(item.endsAt ? { endsAt: item.endsAt } : {}), metadata: { mobilePlatform: item.mobilePlatform || null } }];
      });
      const entitlements = projectEntitlements("pending", grants, now, 0);
      const row = { uid: null, email: typeof data.email === "string" ? data.email : null, disabled: false, entitlements };
      if (matchesDirectory(row, f)) rows.push({ ...row, entitlements: summary(entitlements), emailVerified: false, createdAt: data.createdAt || null, lastSignInAt: null });
    }
  }
  return { rows, scanned, nextCursor, source: f.source };
}
