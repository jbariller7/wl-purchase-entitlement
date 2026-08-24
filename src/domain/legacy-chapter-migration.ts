import { LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF } from "./catalog.js";
import type { LedgerGrant, Product } from "./model.js";

export type LegacyChapterProduct = "legacy_chapter_1" | "legacy_chapter_2" | "legacy_chapter_3" | "legacy_chapter_4";

export function isLegacyChapterProduct(product: Product): product is LegacyChapterProduct {
  return /^legacy_chapter_[1-4]$/.test(product);
}

export function chapterMigrationTransactionId(originalTransactionId: string): string {
  return `chapter-full-upgrade:${originalTransactionId}`;
}

export function isEligibleHistoricalChapterPurchase(startsAt: string, cutoff = LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF): boolean {
  const purchase = Date.parse(startsAt);
  const deadline = Date.parse(cutoff);
  return Number.isFinite(purchase) && Number.isFinite(deadline) && purchase <= deadline;
}

export function chapterMigrationGrant(original: LedgerGrant): LedgerGrant | undefined {
  if (!isLegacyChapterProduct(original.product) || !isEligibleHistoricalChapterPurchase(original.startsAt)) return undefined;
  return {
    id: "",
    uid: original.uid,
    provider: original.provider,
    ...(original.providerCustomerId ? { providerCustomerId: original.providerCustomerId } : {}),
    providerTransactionId: chapterMigrationTransactionId(original.providerTransactionId),
    product: "mobile_polyglot_permanent",
    state: original.state,
    startsAt: original.startsAt,
    ...(original.state === "revoked" || original.state === "refunded" || original.state === "expired" ? { endsAt: original.endsAt ?? original.refundedAt ?? original.startsAt } : {}),
    ...(original.refundedAt ? { refundedAt: original.refundedAt } : {}),
    metadata: {
      migration: "historical_chapter_to_polyglot_permanent",
      originalProduct: original.product,
      originalTransactionId: original.providerTransactionId,
      cutoff: LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF
    }
  };
}
