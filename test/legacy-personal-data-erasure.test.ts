import { describe, expect, it, vi } from "vitest";
import { LegacyPersonalDataErasureService } from "../src/legacy/personal-data-erasure.js";

describe("legacy external personal-data erasure", () => {
  it("clears only buyer-email cells and asks MailerLite to forget each subscriber", async () => {
    const batchClear = vi.fn(async () => ({}));
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (method === "GET" && url.endsWith("buyer%2Bone%40example.com")) {
        return new Response(JSON.stringify({ data: { id: "subscriber-1" } }), { status: 200 });
      }
      if (method === "GET" && url.endsWith("missing%40example.com")) return new Response("", { status: 404 });
      if (method === "POST" && url.endsWith("subscriber-1/forget")) return new Response("{}", { status: 200 });
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const service = new LegacyPersonalDataErasureService({
      fetchImpl,
      sheetsFactory: async () => ({ spreadsheets: { values: { batchClear } } }),
      spreadsheetId: "sheet-test",
      mailerLiteToken: "mailer-test-token"
    });

    const result = await service.erase({
      emails: [" Buyer+One@Example.com ", "missing@example.com", "buyer+one@example.com"],
      sheetAssignments: [
        { sheetTab: "English Steam", rowNumber: 12 },
        { sheetTab: "It's French", rowNumber: 18 },
        { sheetTab: "English Steam", rowNumber: 12 }
      ]
    });

    expect(result).toEqual({ sheetEmailCellsCleared: 2, mailerLiteSubscribersForgotten: 1 });
    expect(batchClear).toHaveBeenCalledWith({
      spreadsheetId: "sheet-test",
      requestBody: { ranges: ["'English Steam'!B12", "'It''s French'!B18"] }
    });
    expect(requests).toEqual([
      { url: "https://connect.mailerlite.com/api/subscribers/buyer%2Bone%40example.com", method: "GET" },
      { url: "https://connect.mailerlite.com/api/subscribers/subscriber-1/forget", method: "POST" },
      { url: "https://connect.mailerlite.com/api/subscribers/missing%40example.com", method: "GET" }
    ]);
  });

  it("never copies a MailerLite response body into operational errors", async () => {
    const fetchImpl = vi.fn(async () => new Response("buyer@example.com private response", { status: 500 })) as typeof fetch;
    const service = new LegacyPersonalDataErasureService({
      fetchImpl,
      sheetsFactory: async () => ({ spreadsheets: { values: { batchClear: async () => ({}) } } }),
      spreadsheetId: "sheet-test",
      mailerLiteToken: "mailer-test-token"
    });
    await expect(service.erase({ emails: ["buyer@example.com"], sheetAssignments: [] }))
      .rejects.toThrow("MailerLite subscriber lookup failed (500).");
  });

  it("rejects invalid Sheet coordinates before making an external call", async () => {
    const service = new LegacyPersonalDataErasureService({
      fetchImpl: vi.fn() as unknown as typeof fetch,
      sheetsFactory: async () => ({ spreadsheets: { values: { batchClear: async () => ({}) } } }),
      spreadsheetId: "sheet-test",
      mailerLiteToken: "mailer-test-token"
    });
    await expect(service.erase({
      emails: [],
      sheetAssignments: [{ sheetTab: "English Steam", rowNumber: 0 }]
    })).rejects.toThrow("invalid Google Sheet row number");
  });
});
