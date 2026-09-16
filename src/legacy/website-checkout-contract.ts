/** Stable machine values are independent of translated labels. This contract
 * does not activate payment links or grant entitlements by email/URL alone. */
export type WebsiteOffer = "single" | "polyglot" | "premium";
export interface WebsitePaymentLinkRegistration {
  paymentLinkId: string;
  priceId: string;
  locale: string;
  offer: WebsiteOffer;
}
export const WEBSITE_BASE_LANGUAGE_LOCALES: Readonly<Record<string, string>> = {
  US: "en", EN: "en", FR: "fr", ES: "es", EX: "es-MX", DE: "de",
  PT: "pt-BR", EPT: "pt-PT", IT: "it", KR: "ko", JP: "ja", JP_hir: "ja",
  NL: "nl", ZH: "zh-CN", ZH_trad: "zh-TW", ZH_hir: "zh-CN", ID: "id",
  AR: "ar", AR_hir: "ar", PL: "pl", UK: "uk", RU: "ru", SV: "sv", HY: "hy"
};
const learningLanguages = new Set(["french", "spanish", "german", "italian", "portuguese", "korean", "japanese", "mandarin", "english"]);
export function parseRegisteredWebsiteCheckout(input: {
  paymentLinkId: string;
  priceId: string;
  customFields: unknown;
}, registrations: readonly WebsitePaymentLinkRegistration[]) {
  const registration = registrations.find(x => x.paymentLinkId === input.paymentLinkId);
  if (!registration) return undefined;
  if (input.priceId !== registration.priceId) throw new Error("Checkout price does not match its registered offer.");
  if (!Array.isArray(input.customFields)) throw new Error("Checkout fields are missing.");
  const fields = new Map<string, string>();
  for (const item of input.customFields) {
    if (!item || typeof item.key !== "string" || typeof item.dropdown?.value !== "string" || fields.has(item.key)) {
      throw new Error("Checkout fields are invalid or duplicated.");
    }
    fields.set(item.key, item.dropdown.value);
  }
  const delivery = fields.get("playmode");
  if (delivery !== "steam" && delivery !== "direct") throw new Error("PC/Mac delivery choice is invalid.");
  const language = fields.get("language");
  const mobilePlatform = fields.get("mobileplatform");
  if (registration.offer === "single" && (!language || !learningLanguages.has(language))) throw new Error("Learning language is invalid.");
  if (registration.offer === "premium" && !["android", "ios", "later"].includes(mobilePlatform ?? "")) throw new Error("Mobile platform choice is invalid.");
  const expected = registration.offer === "single" ? ["playmode", "language"] : registration.offer === "premium" ? ["playmode", "mobileplatform"] : ["playmode"];
  if (fields.size !== expected.length || [...fields.keys()].some(key => !expected.includes(key))) throw new Error("Unexpected checkout fields.");
  return { ...registration, delivery, ...(language ? { language } : {}), ...(mobilePlatform ? { mobilePlatform } : {}) };
}
