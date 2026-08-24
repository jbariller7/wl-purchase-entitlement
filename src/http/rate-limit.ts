import type { Firestore } from "firebase-admin/firestore";
import { stableDocumentId } from "../infrastructure/ids.js";
import { HttpError } from "./auth.js";

export interface RateLimitPolicy {
  action: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  remaining: number;
  resetAt: string;
}

export function rateLimitDocumentId(namespace: string, subject: string, action: string): string {
  return stableDocumentId("rate", `v1:${namespace}:${subject}:${action}`);
}

export async function consumeRateLimit(input: {
  db: Firestore;
  namespace: "api" | "admin";
  subject: string;
  policy: RateLimitPolicy;
  now: Date;
}): Promise<RateLimitResult> {
  const { policy } = input;
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1 || !Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1) {
    throw new Error("Invalid server rate-limit policy.");
  }
  const id = rateLimitDocumentId(input.namespace, input.subject, policy.action);
  const ref = input.db.collection("securityRateLimits").doc(id);
  const nowMs = input.now.getTime();

  try {
    return await input.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists ? snapshot.data() : undefined;
      const storedResetMs = typeof data?.resetAt === "string" ? Date.parse(data.resetAt) : Number.NaN;
      const rawCount = data?.count;
      const storedCount = typeof rawCount === "number" && Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : 0;
      const reset = !snapshot.exists || !Number.isFinite(storedResetMs) || nowMs >= storedResetMs;
      const resetMs = reset ? nowMs + policy.windowSeconds * 1000 : storedResetMs;
      const count = reset ? 0 : storedCount;

      if (count >= policy.limit) {
        const retryAfter = Math.max(1, Math.ceil((resetMs - nowMs) / 1000));
        throw new HttpError(429, "Too many requests. Try again after the indicated delay.", {
          "retry-after": String(retryAfter)
        });
      }

      const nextCount = count + 1;
      const resetAt = new Date(resetMs).toISOString();
      transaction.set(ref, {
        action: policy.action,
        count: nextCount,
        windowStartedAt: reset ? input.now.toISOString() : data?.windowStartedAt ?? input.now.toISOString(),
        resetAt,
        updatedAt: input.now.toISOString(),
        expiresAt: resetAt
      });
      return { remaining: policy.limit - nextCount, resetAt };
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Mutations and costly reads must fail closed if abuse protection cannot
    // make an atomic decision.
    throw new HttpError(503, "Request protection is temporarily unavailable. Try again shortly.");
  }
}
