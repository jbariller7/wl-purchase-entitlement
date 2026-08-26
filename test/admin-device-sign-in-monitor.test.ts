import { describe, expect, it } from "vitest";
import { AdminOperationsService } from "../src/admin/operations-service.js";

const deviceCounts: Record<string, number> = {
  pending: 2,
  approved: 1,
  issuing: 3,
  consumed: 18,
  expired: 4
};

function emptySnapshot() {
  return { docs: [], size: 0 };
}

function query(collectionName: string, state?: string): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  value.where = (_field: string, _operator: string, nextState: string) => query(collectionName, nextState);
  value.orderBy = () => value;
  value.limit = () => value;
  value.select = () => value;
  value.get = async () => emptySnapshot();
  value.count = () => ({
    get: async () => ({
      data: () => ({ count: collectionName === "deviceSignInSessions" ? deviceCounts[state || ""] || 0 : 0 })
    })
  });
  value.doc = () => ({ get: async () => ({ exists: false, data: () => undefined }) });
  return value;
}

describe("administrator device-sign-in monitoring", () => {
  it("returns aggregate states without exposing session identifiers or secrets", async () => {
    const db = { collection: (name: string) => query(name) };
    const result = await new AdminOperationsService(db as never, {} as never).operations() as {
      deviceSignIn: Record<string, number>;
    };

    expect(result.deviceSignIn).toEqual(deviceCounts);
    const serialized = JSON.stringify(result);
    for (const privateField of ["userCode", "pollSecret", "deviceLabel", "approvedUid", "pollSecretHash"]) {
      expect(serialized).not.toContain(privateField);
    }
  });
});
