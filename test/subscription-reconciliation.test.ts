import { describe, expect, it } from "vitest";
import {
  runSubscriptionReconciliation,
  type SubscriptionReconciliationHandlers,
  type SubscriptionReconciliationRepository,
  type SubscriptionReconciliationResult,
  type SubscriptionReconciliationTarget
} from "../src/reconciliation/subscription-reconciler.js";

class FakeRepository implements SubscriptionReconciliationRepository {
  acquired = true;
  began = false;
  released = false;
  succeeded: string[] = [];
  failed: string[] = [];
  finished?: Omit<SubscriptionReconciliationResult, "runId">;
  runFailure?: unknown;

  constructor(readonly targets: SubscriptionReconciliationTarget[] = []) {}
  async acquireLease(): Promise<boolean> { return this.acquired; }
  async releaseLease(): Promise<void> { this.released = true; }
  async bootstrap(): Promise<number> { return 2; }
  async beginRun(): Promise<void> { this.began = true; }
  async due(): Promise<SubscriptionReconciliationTarget[]> { return this.targets; }
  async markSucceeded(target: SubscriptionReconciliationTarget): Promise<void> { this.succeeded.push(target.id); }
  async markFailed(target: SubscriptionReconciliationTarget): Promise<void> { this.failed.push(target.id); }
  async finishRun(_runId: string, result: Omit<SubscriptionReconciliationResult, "runId">): Promise<void> { this.finished = result; }
  async failRun(_runId: string, error: unknown): Promise<void> { this.runFailure = error; }
}

const now = new Date("2026-08-24T12:00:00.000Z");
const targets: SubscriptionReconciliationTarget[] = [
  { id: "stripe-target", provider: "stripe", providerSubscriptionId: "sub_test", uid: "user-a", state: "active" },
  { id: "play-target", provider: "google_play", providerSubscriptionId: "play_digest", uid: "user-b", state: "grace" },
  { id: "apple-target", provider: "apple", providerSubscriptionId: "1000000001", uid: "user-c", state: "active" }
];

describe("scheduled subscription reconciliation", () => {
  it("isolates a provider failure and completes every other due target", async () => {
    const repository = new FakeRepository(targets);
    const calls: string[] = [];
    const handlers: SubscriptionReconciliationHandlers = {
      stripe: async (target) => { calls.push(target.id); },
      google_play: async (target) => { calls.push(target.id); throw new Error("provider temporarily unavailable"); },
      apple: async (target) => { calls.push(target.id); }
    };
    const result = await runSubscriptionReconciliation({ repository, handlers, now, runId: "run-test" });
    expect(result).toEqual({
      runId: "run-test", state: "partial", bootstrapped: 2, attempted: 3, succeeded: 2, failed: 1
    });
    expect(calls.sort()).toEqual(["apple-target", "play-target", "stripe-target"]);
    expect(repository.succeeded.sort()).toEqual(["apple-target", "stripe-target"]);
    expect(repository.failed).toEqual(["play-target"]);
    expect(repository.finished).toMatchObject({ state: "partial", attempted: 3, succeeded: 2, failed: 1 });
    expect(repository.released).toBe(true);
  });

  it("does not query or call providers while another run owns the lease", async () => {
    const repository = new FakeRepository(targets);
    repository.acquired = false;
    let providerCalls = 0;
    const handlers: SubscriptionReconciliationHandlers = {
      stripe: async () => { providerCalls += 1; },
      google_play: async () => { providerCalls += 1; },
      apple: async () => { providerCalls += 1; }
    };
    await expect(runSubscriptionReconciliation({ repository, handlers, now, runId: "run-held" })).resolves.toMatchObject({
      state: "skipped", reason: "lease_held", attempted: 0
    });
    expect(providerCalls).toBe(0);
    expect(repository.began).toBe(false);
    expect(repository.released).toBe(false);
  });
});
