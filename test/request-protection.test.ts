import { describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { requireAppCheck } from "../src/http/app-check.js";
import { HttpError } from "../src/http/auth.js";
import { apiAllowedOrigins, requestHeader, requireAllowedOrigin } from "../src/http/origin.js";
import { consumeRateLimit, rateLimitDocumentId } from "../src/http/rate-limit.js";
import { errorResponse } from "../src/http/response.js";

function fakeFirestore() {
  const documents = new Map<string, Record<string, unknown>>();
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ({ path: `${collection}/${id}` })
    }),
    runTransaction: async <T>(callback: (transaction: {
      get: (ref: { path: string }) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>;
      set: (ref: { path: string }, data: Record<string, unknown>) => void;
    }) => Promise<T>): Promise<T> => {
      const writes = new Map<string, Record<string, unknown>>();
      const result = await callback({
        get: async (ref) => ({ exists: documents.has(ref.path), data: () => documents.get(ref.path) }),
        set: (ref, data) => { writes.set(ref.path, data); }
      });
      for (const [path, data] of writes) documents.set(path, data);
      return result;
    }
  } as unknown as Firestore;
  return { db, documents };
}

describe("request protection", () => {
  it("rejects a present untrusted browser origin while allowing native requests without Origin", () => {
    const allowed = apiAllowedOrigins(true);
    expect(() => requireAllowedOrigin(undefined, allowed)).not.toThrow();
    expect(() => requireAllowedOrigin("https://appassets.local", allowed)).not.toThrow();
    expect(() => requireAllowedOrigin("https://evil.example", allowed)).toThrowError(HttpError);
    expect(requestHeader({ OrIgIn: "https://wonderlang.net" }, "origin")).toBe("https://wonderlang.net");
  });

  it("keeps the UID out of the rate-limit document ID", () => {
    const uid = "firebase-user-sensitive-id";
    const id = rateLimitDocumentId("api", uid, "checkout");
    expect(id).toMatch(/^rate_[0-9a-f]{48}$/);
    expect(id).not.toContain(uid);
  });

  it("atomically limits each account/action and returns a safe Retry-After", async () => {
    const { db, documents } = fakeFirestore();
    const base = {
      db,
      namespace: "api" as const,
      subject: "user-123",
      policy: { action: "checkout", limit: 2, windowSeconds: 60 }
    };
    await expect(consumeRateLimit({ ...base, now: new Date("2026-08-24T12:00:00.000Z") })).resolves.toMatchObject({ remaining: 1 });
    await expect(consumeRateLimit({ ...base, now: new Date("2026-08-24T12:00:01.000Z") })).resolves.toMatchObject({ remaining: 0 });
    const denied = await consumeRateLimit({ ...base, now: new Date("2026-08-24T12:00:02.000Z") }).catch((error: unknown) => error);
    expect(denied).toBeInstanceOf(HttpError);
    expect((denied as HttpError).status).toBe(429);
    expect(errorResponse(denied).headers["retry-after"]).toBe("58");
    expect(JSON.stringify([...documents.entries()])).not.toContain("user-123");

    await expect(consumeRateLimit({ ...base, now: new Date("2026-08-24T12:01:01.000Z") })).resolves.toMatchObject({ remaining: 1 });
  });

  it("fails closed when the rate-limit transaction cannot run", async () => {
    const db = { runTransaction: vi.fn().mockRejectedValue(new Error("database unavailable")), collection: () => ({ doc: () => ({}) }) } as unknown as Firestore;
    const error = await consumeRateLimit({
      db,
      namespace: "api",
      subject: "user-123",
      policy: { action: "checkout", limit: 2, windowSeconds: 60 },
      now: new Date()
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(503);
    expect((error as Error).message).not.toContain("database unavailable");
  });

  it("enforces App Check only after the fail-closed switch is enabled", async () => {
    const verifier = { verifyToken: vi.fn().mockResolvedValue({ appId: "test-app" }) };
    await expect(requireAppCheck(undefined, verifier as never, false)).resolves.toBeUndefined();
    expect(verifier.verifyToken).not.toHaveBeenCalled();

    await expect(requireAppCheck(undefined, verifier as never, true)).rejects.toMatchObject({ status: 401 });
    await expect(requireAppCheck("valid-token", verifier as never, true)).resolves.toBeUndefined();
    expect(verifier.verifyToken).toHaveBeenCalledWith("valid-token");

    verifier.verifyToken.mockRejectedValueOnce(new Error("signature details must stay private"));
    await expect(requireAppCheck("invalid-token", verifier as never, true)).rejects.toMatchObject({
      status: 401,
      message: "The Firebase App Check token is invalid or expired."
    });
  });
});
