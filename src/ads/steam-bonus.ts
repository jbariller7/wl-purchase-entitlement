import type { Firestore } from "firebase-admin/firestore";
import { stableDocumentId } from "../infrastructure/ids.js";

// This is the owner's Steam PDF-request proxy, not a verified Steam receipt.
// A person can request the PDFs on several computers without creating new sales.
export async function recordSteamBonus(db: Firestore, input: {
  emailSha256: string; ipAddress?: string; userAgent?: string; fbp?: string; fbc?: string;
}, now: Date) {
  const emailHash = input.emailSha256;
  const eventId = `steam-bonus-v1:${emailHash}`;
  const ref = db.collection("steamBonusConversions").doc(emailHash);
  const job = db.collection("outbox").doc(stableDocumentId("meta_conversion", `meta:${eventId}`));
  return db.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      // Allow a response-lost retry within Meta's deduplication window only.
      const first = Number(existing.data()?.eventTime);
      return {eventId, trackBrowser: Number.isFinite(first) && now.getTime()/1000-first < 24*3600};
    }
    const eventTime = Math.floor(now.getTime()/1000);
    tx.create(ref, {eventId, eventTime, kind:"steam_pdf_proxy"});
    tx.create(job, {
      id:job.id, kind:"meta_conversion", dedupeKey:`meta:${eventId}`,
      createdAt:now.toISOString(), notBefore:now.toISOString(), attemptCount:0, state:"pending",
      payload:{eventName:"Purchase",eventId,eventTime,
        eventSourceUrl:"https://wonderlang.app/steam-bonus/",emailSha256:emailHash,
        ...(input.ipAddress?{ipAddress:input.ipAddress}:{}),
        ...(input.userAgent?{userAgent:input.userAgent}:{}),
        ...(input.fbp?{fbp:input.fbp}:{}),...(input.fbc?{fbc:input.fbc}:{}),
        value:0,currency:"USD",product:"WonderLang_Bonus",conversionKind:"steam_pdf_proxy"}
    });
    return {eventId,trackBrowser:true};
  });
}
