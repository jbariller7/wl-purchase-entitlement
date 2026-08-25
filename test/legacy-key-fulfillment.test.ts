import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LegacyOrder } from "../src/domain/model.js";

const providerMocks = vi.hoisted(() => ({
  sheetUpdate: vi.fn()
}));

vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class MockJwt {} },
    sheets: () => ({ spreadsheets: { values: { update: providerMocks.sheetUpdate } } })
  }
}));

import { LegacyKeyFulfillmentService } from "../src/legacy/key-fulfillment.js";

interface FakeKey {
  id: string;
  key: string;
  sheetTab: string;
  rowNumber: number;
  state: "available" | "assigned";
  assignedOrderId?: string;
  assignedEmail?: string;
  assignedAt?: string;
}

class FakeQuery {
  readonly filters: Array<[string, unknown]>;
  readonly maximum: number;

  constructor(readonly database: FakeFirestore, filters: Array<[string, unknown]> = [], maximum = Number.MAX_SAFE_INTEGER) {
    this.filters = filters;
    this.maximum = maximum;
  }

  where(field: string, _operator: string, value: unknown): FakeQuery {
    return new FakeQuery(this.database, [...this.filters, [field, value]], this.maximum);
  }

  limit(maximum: number): FakeQuery {
    return new FakeQuery(this.database, this.filters, maximum);
  }
}

class FakeDocumentRef {
  constructor(readonly database: FakeFirestore, readonly collectionName: string, readonly id: string) {}

  async set(value: Record<string, unknown>, options?: { merge?: boolean }): Promise<void> {
    const current = this.database.documents.get(`${this.collectionName}/${this.id}`) ?? {};
    this.database.documents.set(`${this.collectionName}/${this.id}`, options?.merge ? { ...current, ...value } : value);
  }
}

class FakeCollection {
  constructor(readonly database: FakeFirestore, readonly name: string) {}

  doc(id: string): FakeDocumentRef {
    return new FakeDocumentRef(this.database, this.name, id);
  }

  where(field: string, operator: string, value: unknown): FakeQuery {
    return new FakeQuery(this.database).where(field, operator, value);
  }
}

class FakeFirestore {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly keys: FakeKey[];
  transactionCount = 0;

  constructor(keys: Array<Omit<FakeKey, "state"> & { state?: FakeKey["state"] }>) {
    this.keys = keys.map((key) => ({ ...key, state: key.state ?? "available" }));
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this, name);
  }

  async runTransaction<T>(callback: (transaction: {
    get: (target: FakeDocumentRef | FakeQuery) => Promise<unknown>;
    update: (reference: FakeDocumentRef, value: Record<string, unknown>) => void;
    create: (reference: FakeDocumentRef, value: Record<string, unknown>) => void;
  }) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return callback({
      get: async (target) => {
        if (target instanceof FakeDocumentRef) {
          const data = this.documents.get(`${target.collectionName}/${target.id}`);
          return { exists: Boolean(data), data: () => data };
        }
        const matches = this.keys
          .filter((key) => target.filters.every(([field, value]) => key[field as keyof FakeKey] === value))
          .slice(0, target.maximum)
          .map((key) => ({
            ref: new FakeDocumentRef(this, "legacyKeys", key.id),
            data: () => key
          }));
        return { size: matches.length, docs: matches };
      },
      update: (reference, value) => {
        if (reference.collectionName !== "legacyKeys") throw new Error("Unexpected transaction update.");
        const key = this.keys.find((candidate) => candidate.id === reference.id);
        if (!key) throw new Error("Missing test key.");
        Object.assign(key, value);
      },
      create: (reference, value) => {
        const path = `${reference.collectionName}/${reference.id}`;
        if (this.documents.has(path)) throw new Error("Document already exists.");
        this.documents.set(path, value);
      }
    });
  }
}

const original = { ...process.env };
const order: LegacyOrder = {
  id: "cs_fulfillment",
  stripeCheckoutSessionId: "cs_fulfillment",
  stripePaymentIntentId: "pi_fulfillment",
  buyerEmail: "player@example.com",
  paymentLinkId: "plink_test",
  productCode: "POLY_STEAM",
  playMode: "STEAM",
  quantity: 2,
  amountTotal: 5_999,
  currency: "USD",
  paidAt: "2026-08-25T12:00:00.000Z",
  firebaseUid: "uid_fulfillment"
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "sheets-test@example.iam.gserviceaccount.com",
    GOOGLE_PRIVATE_KEY: "test-private-key",
    GOOGLE_SHEET_ID: "sheet-test",
    MAILERLITE_API_TOKEN: "mailerlite-test-token",
    ML_GROUPS_ALL: "all-buyers, shared",
    ML_GROUPS_POLY_STEAM: "steam-buyers, shared"
  });
  providerMocks.sheetUpdate.mockResolvedValue({});
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
});

afterEach(() => {
  process.env = { ...original };
  vi.unstubAllGlobals();
});

function inventory(): FakeFirestore {
  return new FakeFirestore([
    { id: "key-a", key: "AAAA-BBBB", sheetTab: "Polyglot Steam", rowNumber: 2 },
    { id: "key-b", key: "CCCC-DDDD", sheetTab: "Polyglot Steam", rowNumber: 3 },
    { id: "key-c", key: "EEEE-FFFF", sheetTab: "Polyglot Steam", rowNumber: 4 }
  ]);
}

describe("legacy key fulfillment replay safety", () => {
  it("allocates exactly one stable key set when the same order is fulfilled twice", async () => {
    const database = inventory();
    const service = new LegacyKeyFulfillmentService(database as never);
    const first = await service.fulfill(order, "Polyglot Steam", new Date("2026-08-25T12:01:00.000Z"));
    const second = await service.fulfill(order, "Polyglot Steam", new Date("2026-08-25T12:02:00.000Z"));

    expect(first).toEqual({ keyCount: 2 });
    expect(second).toEqual({ keyCount: 2 });
    expect(database.keys.filter((key) => key.state === "assigned")).toHaveLength(2);
    expect(database.keys.filter((key) => key.state === "available")).toHaveLength(1);
    expect(database.keys.filter((key) => key.assignedOrderId === order.id).map((key) => key.key)).toEqual([
      "AAAA-BBBB", "CCCC-DDDD"
    ]);
    const fulfillment = database.documents.get(`legacyFulfillments/${order.id}`);
    expect(fulfillment?.keys).toEqual([
      { key: "AAAA-BBBB", sheetTab: "Polyglot Steam", rowNumber: 2 },
      { key: "CCCC-DDDD", sheetTab: "Polyglot Steam", rowNumber: 3 }
    ]);
    expect(providerMocks.sheetUpdate).toHaveBeenCalledTimes(4);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    const subscriber = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(subscriber).toEqual({
      email: "player@example.com",
      fields: { steam_key: "AAAA-BBBB", extra_steam_key: "CCCC-DDDD" },
      groups: ["all-buyers", "shared", "steam-buyers"]
    });
  });

  it("reuses the original key after MailerLite fails between allocation and completion", async () => {
    const database = new FakeFirestore([
      { id: "key-a", key: "AAAA-BBBB", sheetTab: "Polyglot Steam", rowNumber: 2 },
      { id: "key-b", key: "CCCC-DDDD", sheetTab: "Polyglot Steam", rowNumber: 3 }
    ]);
    const service = new LegacyKeyFulfillmentService(database as never);
    const retryOrder = { ...order, quantity: 1 };
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("private provider body", { status: 503, headers: { "x-request-id": "safe-request-id" } }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    await expect(service.fulfill(retryOrder, "Polyglot Steam", new Date("2026-08-25T12:01:00.000Z")))
      .rejects.toThrow("MailerLite upsert failed (503) [request safe-request-id]");
    await expect(service.fulfill(retryOrder, "Polyglot Steam", new Date("2026-08-25T12:02:00.000Z")))
      .resolves.toEqual({ keyCount: 1 });

    expect(database.keys.filter((key) => key.state === "assigned")).toHaveLength(1);
    expect(database.keys.find((key) => key.state === "assigned")?.key).toBe("AAAA-BBBB");
    expect(database.keys.find((key) => key.key === "CCCC-DDDD")?.state).toBe("available");
    expect(providerMocks.sheetUpdate).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("fails before external delivery when inventory cannot satisfy the order", async () => {
    const database = new FakeFirestore([
      { id: "key-a", key: "AAAA-BBBB", sheetTab: "Polyglot Steam", rowNumber: 2 }
    ]);
    const service = new LegacyKeyFulfillmentService(database as never);

    await expect(service.fulfill(order, "Polyglot Steam", new Date("2026-08-25T12:01:00.000Z")))
      .rejects.toThrow("Only 1 key(s) remain in Polyglot Steam; 2 required");
    expect(database.keys[0]?.state).toBe("available");
    expect(providerMocks.sheetUpdate).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
