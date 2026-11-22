import {randomBytes, createHash, timingSafeEqual} from "node:crypto";
import type {Firestore} from "firebase-admin/firestore";
import type {Auth} from "firebase-admin/auth";
import type {AdminActor} from "../admin/audit.js";
import {ensureAdminCustomer} from "../admin/create-customer.js";
import {accountEmails} from "./account-email.js";
import {HttpError} from "../http/auth.js";
import {invalidateDeviceSignInsForUid} from "../device-sign-in/service.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const unavailable = () => new HttpError(409, "Recovery link unavailable.");
export class PasswordRecoveryService {
  constructor(private db: Firestore, private auth: Auth) {}

  async issue(input: {email: string; actor: AdminActor; reason: string; now: Date}) {
    const {user} = await ensureAdminCustomer(this.auth, input.email);
    if (user.disabled) throw new HttpError(409, "This account is disabled. Review it in the customer directory before recovering access.");
    if (user.customClaims?.admin) throw new HttpError(403, "Administrator accounts require administrator recovery, not customer recovery.");
    if (user.uid.startsWith("store-reviewer-")) throw new HttpError(403, "Use the store reviewer account controls to reset this reviewer's credentials.");
    // Ownership is explicitly verified by the issuing admin. Some Google/Apple
    // accounts have only a provider email; keep their UID and attach that email
    // atomically with the new password when the recovery link is redeemed.
    const email = user.email?.trim().toLowerCase() || input.email.trim().toLowerCase();
    if (!accountEmails(user).includes(email)) throw new HttpError(409, "This email is no longer linked to the account. Refresh the customer record and verify its current email.");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = digest(token);
    const expiresAt = new Date(input.now.getTime() + 30 * 60_000).toISOString();
    const ref = this.db.collection("passwordRecoveries").doc(user.uid);
    const audit = this.db.collection("adminAudit").doc();
    await this.db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.state === "processing" && Date.parse(current.expiresAt) > input.now.getTime()) throw new HttpError(409, "Recovery is being completed. Try again shortly.");
      tx.set(ref, {uid:user.uid, email, tokenHash, state:"pending",
        expiresAt, createdAt:input.now.toISOString(), issuedBy:input.actor.uid});
      tx.create(audit, {id:audit.id, actorUid:input.actor.uid, actorEmail:input.actor.email,
        action:"account.recovery.issue", targetType:"user", targetId:user.uid,
        summary:"Issued customer password recovery after identity verification",
        metadata:{reason:input.reason, email, expiresAt}, createdAt:input.now.toISOString()});
    });
    return {link:`https://wonderlang.app/account/#recovery=${encodeURIComponent(user.uid)}.${token}`, expiresAt};
  }

  async consume(input: {uid: string; token: string; password: string; now: Date}) {
    if (input.password.length < 12 || input.password.length > 128) throw new HttpError(400, "Password must contain 12–128 characters.");
    const ref = this.db.collection("passwordRecoveries").doc(input.uid);
    const tokenHash = digest(input.token);
    const email = await this.db.runTransaction(async tx => {
      const record = (await tx.get(ref)).data();
      if (!record || record.state !== "pending" || Date.parse(record.expiresAt) <= input.now.getTime()
        || typeof record.tokenHash !== "string" || record.tokenHash.length !== tokenHash.length
        || !timingSafeEqual(Buffer.from(record.tokenHash), Buffer.from(tokenHash))) throw unavailable();
      tx.update(ref, {state:"processing", startedAt:input.now.toISOString()});
      return record.email as string;
    });
    try {
      const user = await this.auth.getUser(input.uid);
      if (user.disabled || user.customClaims?.admin || user.uid.startsWith("store-reviewer-")
        || (user.email ? user.email.trim().toLowerCase() !== email : !accountEmails(user).includes(email))) throw unavailable();
      // The issuing administrator has explicitly verified ownership of this email.
      await this.auth.updateUser(input.uid, {password:input.password, emailVerified:true, ...(!user.email ? {email} : {})});
      await this.auth.revokeRefreshTokens(input.uid);
      await invalidateDeviceSignInsForUid(this.db, input.uid, input.now);
      await ref.update({state:"consumed", completedAt:new Date().toISOString()});
      return {email, signInAfter:(Math.floor(Math.max(Date.now(), input.now.getTime()) / 1000) + 1) * 1000};
    } catch {
      await ref.update({state:"failed", failedAt:new Date().toISOString()}).catch(() => undefined);
      throw unavailable();
    }
  }
}
