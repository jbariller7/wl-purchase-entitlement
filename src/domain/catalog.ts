import type { Product } from "./model.js";

export const MONTHLY_PRICE_USD_CENTS = 699;
export const STRIPE_FAILURE_GRACE_DAYS = 7;

export const PRODUCT_CAPABILITIES: Record<
  Product,
  { fullGame: boolean; allLanguages: boolean; cloudSave: boolean; chapter?: number }
> = {
  mobile_full_monthly: { fullGame: true, allLanguages: true, cloudSave: true },
  mobile_full_lifetime: { fullGame: true, allLanguages: true, cloudSave: true },
  legacy_mobile_full: { fullGame: true, allLanguages: true, cloudSave: false },
  legacy_chapter_1: { fullGame: false, allLanguages: false, cloudSave: false, chapter: 1 },
  legacy_chapter_2: { fullGame: false, allLanguages: false, cloudSave: false, chapter: 2 },
  legacy_chapter_3: { fullGame: false, allLanguages: false, cloudSave: false, chapter: 3 },
  legacy_chapter_4: { fullGame: false, allLanguages: false, cloudSave: false, chapter: 4 },
  desktop_language: { fullGame: false, allLanguages: false, cloudSave: false },
  desktop_polyglot: { fullGame: false, allLanguages: false, cloudSave: false },
  desktop_lifetime: { fullGame: false, allLanguages: false, cloudSave: false }
};

export const LEGACY_PLAY_PRODUCT_MAP: Record<string, Product> = {
  wonderlangch1: "legacy_chapter_1",
  wonderlangch2: "legacy_chapter_2",
  wonderlangch3: "legacy_chapter_3",
  wonderlangch4: "legacy_chapter_4",
  wonderlangfull: "mobile_full_lifetime"
};
