import { describe, expect, it, vi } from "vitest";
import { runImportBatches } from "../integrations/web/admin-console/import-runner.js";
const input = api => ({ api, previewId: "original-id", confirmationPhrase: "IMPORT 12 RECORDS", onProgress: vi.fn(), delay: vi.fn() });
describe("import browser continuation", () => {
  it("continues until the server confirms completion", async () => {
    const api = vi.fn().mockResolvedValueOnce({ state: "processing", processed: 5 }).mockResolvedValueOnce({ state: "complete", processed: 12 });
    const args = input(api);
    expect(await runImportBatches(args)).toMatchObject({ state: "complete" });
    expect(api).toHaveBeenCalledTimes(2);
    for (const [,options] of api.mock.calls) expect(options.body).toEqual({ previewId: "original-id", confirmationPhrase: "IMPORT 12 RECORDS", protocolVersion: 2 });
  });
  it("reads durable completion after a 504 instead of submitting a new import", async () => {
    const api = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Timeout"), {status:504})).mockResolvedValueOnce({state:"complete",processed:12});
    expect(await runImportBatches(input(api))).toMatchObject({state:"complete"});
    expect(api.mock.calls[1][0]).toBe("/admin-api/v1/imports/original-id");
  });
  it("waits while a previous request owns the lease", async () => {
    const api = vi.fn().mockResolvedValueOnce({state:"processing",busy:true}).mockResolvedValueOnce({state:"complete"});
    const args=input(api); await runImportBatches(args); expect(args.delay).toHaveBeenCalledWith(3000);
  });
  it("pauses on rejected confirmation and on repeated transport failures", async () => {
    const denied=vi.fn().mockRejectedValue(Object.assign(new Error("Wrong phrase"),{status:400}));
    await expect(runImportBatches(input(denied))).rejects.toThrow("Wrong phrase");
    expect(denied).toHaveBeenCalledTimes(1);
    const api=vi.fn(async path=>{if(path.endsWith("/commit"))throw Object.assign(new Error("Timeout"),{status:504});return {state:"processing"};});
    await expect(runImportBatches(input(api))).rejects.toThrow("Timeout");
    expect(api.mock.calls.filter(([p])=>p.endsWith("/commit"))).toHaveLength(4);
  });
});
