import { createHash, randomBytes } from "node:crypto";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { HttpError } from "../http/auth.js";
import { EntitlementStore } from "../infrastructure/entitlement-store.js";
import { recordAdminAudit, type AdminActor } from "./audit.js";

export const reviewerSlots = ["apple", "google"] as const;
export type ReviewerSlot = typeof reviewerSlots[number];

export class ReviewerAccounts {
  constructor(private db: Firestore, private auth: Auth) {}

  // Fixed UIDs make concurrent creation safe. Never adopt or modify an existing customer.
  async create(slot: ReviewerSlot, actor: AdminActor, now: Date) {
    const uid = `store-reviewer-${slot}`;
    const email = `${slot}-review-${randomBytes(6).toString("hex")}@wonderlang.app`;
    const password = `${randomBytes(24).toString("base64url")}!aA9`;
    try {
      await this.auth.createUser({ uid, email, password, emailVerified: false, disabled: true,
        displayName: slot === "apple" ? "Apple App Review" : "Google Play Review" });
    } catch (error) {
      if ((error as { code?: string }).code === "auth/uid-already-exists") {
        throw new HttpError(409, "This reviewer account already exists. Its password cannot be retrieved; use Firebase to reset it if necessary.");
      }
      throw error;
    }
    await this.db.collection("reviewerAccounts").doc(uid).set({ uid, email, slot,
      createdAt: now.toISOString(), totalLogins: 0, lastLoginAt: null });
    await new EntitlementStore(this.db).upsertGrant({ id: "", uid, provider: "admin",
      providerTransactionId: `reviewer-premium-${slot}`, product: "premium_lifetime_pass",
      state: "active", startsAt: now.toISOString(),
      metadata: { reason: "Dedicated store review account with full game and cloud access", actorUid: actor.uid }
    }, { id: `reviewer-premium:${slot}`, created: Math.floor(now.getTime() / 1000) });
    await recordAdminAudit({ db: this.db, actor, action: "reviewer.create", targetType: "user",
      targetId: uid, summary: `Created ${slot} review account with Premium Lifetime`, now });
    await this.auth.updateUser(uid, { disabled: false });
    // Only this authenticated, no-store response contains the password. Never log or persist it.
    return { uid, email, password };
  }

  async list(now: Date) {
    return Promise.all(reviewerSlots.map(async slot => {
      const uid = `store-reviewer-${slot}`;
      const ref = this.db.collection("reviewerAccounts").doc(uid);
      const snapshot = await ref.get();
      if (!snapshot.exists) return { slot, uid, exists: false };
      const row = snapshot.data()!;
      const [user, recent] = await Promise.all([this.auth.getUser(uid),
        ref.collection("logins").where("authenticatedAt", ">=", new Date(now.getTime() - 7 * 86400_000).toISOString()).get()]);
      return { slot, uid, exists: true, email: user.email, disabled: user.disabled,
        totalLogins: Number(row.totalLogins || 0), lastLoginAt: row.lastLoginAt ?? null,
        last24Hours: recent.docs.filter(d => Date.parse(d.data().authenticatedAt) >= now.getTime() - 86400_000).length,
        last7Days: recent.size, trackingSince: row.createdAt };
    }));
  }

  async recordLogin(token: DecodedIdToken, now: Date) {
    if (!reviewerSlots.some(slot => token.uid === `store-reviewer-${slot}`)) return;
    // Custom-token desktop handoffs are the same login, not a second credential sign-in.
    if (token.firebase?.sign_in_provider === "custom" || !Number.isSafeInteger(token.auth_time) || token.auth_time <= 0) return;
    const ref = this.db.collection("reviewerAccounts").doc(token.uid);
    const id = createHash("sha256").update(`${token.auth_time}:${token.firebase?.sign_in_provider || "unknown"}`).digest("hex");
    const event = ref.collection("logins").doc(id);
    await this.db.runTransaction(async tx => {
      const [account, seen] = await Promise.all([tx.get(ref), tx.get(event)]);
      if (!account.exists || seen.exists) return;
      const authenticatedAt = new Date(token.auth_time * 1000).toISOString();
      tx.create(event, { authenticatedAt, observedAt: now.toISOString(), provider: token.firebase?.sign_in_provider || "unknown" });
      tx.update(ref, { totalLogins: Number(account.data()!.totalLogins || 0) + 1,
        lastLoginAt: [account.data()!.lastLoginAt || "", authenticatedAt].sort().at(-1) });
    });
  }

  async mobileLink(token: DecodedIdToken, now: Date) {
    if (!reviewerSlots.some(slot => token.uid === `store-reviewer-${slot}`)
      || !(await this.db.collection("reviewerAccounts").doc(token.uid).get()).exists) {
      throw new HttpError(403, "This action is available only to dedicated review accounts.");
    }
    if (!token.auth_time || now.getTime() / 1000 - token.auth_time > 600) {
      throw new HttpError(401, "Sign out and sign in again before opening the game.");
    }
    const user = await this.auth.getUser(token.uid);
    if (user.disabled || !user.email) throw new HttpError(403, "Reviewer account is unavailable.");
    const link = await this.auth.generateSignInWithEmailLink(user.email, {
      url: "https://wonderlang.app/account/", handleCodeInApp: true,
      android: { packageName: "com.wonderlang.app", installApp: false },
      iOS: { bundleId: "com.wonderlang.app" }
    });
    return { link, email: user.email };
  }
}
