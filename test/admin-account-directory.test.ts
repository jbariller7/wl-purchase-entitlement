import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { accountDirectory, directoryQuery, matchesDirectory } from "../src/admin/account-directory.js";
import { EntitlementStore } from "../src/infrastructure/entitlement-store.js";
import { projectEntitlements } from "../src/domain/entitlement-projector.js";
import type { LedgerGrant } from "../src/domain/model.js";

const now = new Date("2026-09-21T12:00:00Z");
const premium: LedgerGrant = { id: "g", uid: "u", provider: "admin", providerTransactionId: "private-transaction", product: "premium_lifetime_pass", state: "active", startsAt: "2026-01-01T00:00:00Z" };
afterEach(() => vi.restoreAllMocks());
describe("account directory", () => {
  it("matches partial email, display name and UID case-insensitively with combined filters", () => {
    const row = { uid: "account-123", email: "someone@example.com", name: "Alice Smith", disabled: false, entitlements: projectEntitlements("u", [premium], now, 0) };
    for (const q of ["EXAMPLE", "lice sm", "unt-12"]) expect(matchesDirectory(row, directoryQuery.parse({ q, access: "premium_lifetime", cloud: "yes", platform: "ios", status: "enabled" }))).toBe(true);
    expect(matchesDirectory(row, directoryQuery.parse({ cloud: "no" }))).toBe(false);
    expect(matchesDirectory(row, directoryQuery.parse({ status: "disabled" }))).toBe(false);
  });
  it("paginates Auth users including users without a Firestore account, with no private auth fields", async () => {
    const listUsers = vi.fn().mockResolvedValue({ users: [{ uid: "u", email: "someone@example.com", displayName: "Someone", disabled: false, emailVerified: true, passwordHash: "SECRET", customClaims: { admin: true }, metadata: { creationTime: "date" } }], pageToken: "next" });
    vi.spyOn(EntitlementStore.prototype, "grantsForUid").mockResolvedValue([premium]);
    const result = await accountDirectory({} as Firestore, { listUsers } as unknown as Auth, directoryQuery.parse({ cursor: "previous" }), now);
    expect(listUsers).toHaveBeenCalledWith(100, "previous");
    expect(result.rows).toHaveLength(1);
    expect(result.nextCursor).toBe("next");
    expect(JSON.stringify(result)).not.toMatch(/SECRET|passwordHash|customClaims|private-transaction|sourceGrantIds/);
  });
  it("expires access at read time and retains pagination when a filtered page is empty", async () => {
    vi.spyOn(EntitlementStore.prototype, "grantsForUid").mockResolvedValue([{ ...premium, endsAt: "2026-09-20T00:00:00Z" }]);
    const auth = { listUsers: async () => ({ users: [{ uid: "u", disabled: false, metadata: {} }], pageToken: "next" }) } as unknown as Auth;
    const result = await accountDirectory({} as Firestore, auth, directoryQuery.parse({ access: "premium_lifetime" }), now);
    expect(result.rows).toEqual([]);
    expect(result.nextCursor).toBe("next");
  });
  it("lists pending grants without creating users or returning import notes", async () => {
    const data = { state: "pending", email: "waiting@example.com", rows: [{ kind: "premium_lifetime_pass", startsAt: premium.startsAt, note: "PRIVATE NOTE" }] };
    const query: any = { orderBy: vi.fn(() => query), limit: vi.fn(() => query), startAfter: vi.fn(() => query), get: async () => ({ docs: [{ id: "a", data: () => data }, { id: "b", data: () => ({ ...data, claimedByUid: "claimed" }) }] }) };
    const result = await accountDirectory({ collection: () => query } as unknown as Firestore, {} as Auth, directoryQuery.parse({ source: "pending", cloud: "yes", platform: "ios" }), now);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.uid).toBeNull();
    expect(result.rows[0]!.entitlements.accessKind).toBe("premium_lifetime");
    expect(JSON.stringify(result)).not.toContain("PRIVATE NOTE");
  });
  it("rejects invalid filters and unbounded search strings", () => {
    expect(directoryQuery.safeParse({ source: "anything" }).success).toBe(false);
    expect(directoryQuery.safeParse({ q: "x".repeat(321) }).success).toBe(false);
  });
});
