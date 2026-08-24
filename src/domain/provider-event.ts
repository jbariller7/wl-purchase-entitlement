export interface ProviderEventAttempt {
  status?: string;
  lastAttemptAt?: string;
}

export function providerEventDecision(existing: ProviderEventAttempt | undefined, now: Date): "process" | "duplicate" {
  if (!existing) return "process";
  const processingIsFresh = existing.status === "processing" && Boolean(existing.lastAttemptAt)
    && Date.parse(existing.lastAttemptAt as string) > now.getTime() - 5 * 60 * 1000;
  return existing.status === "processed" || processingIsFresh ? "duplicate" : "process";
}
