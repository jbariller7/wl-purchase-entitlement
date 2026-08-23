export const LEGACY_SINGLE_LANGUAGE_PAYMENT_LINKS = new Set([
  "plink_1RoKYZBFbQoDa6p0hCPS3d2g",
  "plink_1Rzg6lBFbQoDa6p0bmGphygN",
  "plink_1RvKx8BFbQoDa6p0PaVih8U5"
]);

export const LEGACY_BOGO_PAYMENT_LINKS = new Set([
  "plink_1SzYQNBFbQoDa6p0A1WwDTCI",
  "plink_1SzYjcBFbQoDa6p08zbQWhKF"
]);

export const LEGACY_POLYGLOT_PAYMENT_LINKS = new Set([
  "plink_1RoLRRBFbQoDa6p0g9zXIJaM",
  "plink_1Rzg0NBFbQoDa6p0fL5aVAsU",
  "plink_1RvL4VBFbQoDa6p09A00tNAR",
  "plink_1RoNLzBFbQoDa6p0lvW7lw5f",
  "plink_1RoN4QBFbQoDa6p0fQ8Xc3Vs",
  "plink_1S2w5eBFbQoDa6p06bwPV6Hp",
  "plink_1Rzg7fBFbQoDa6p0UCIOzCtk",
  "plink_1S2wD2BFbQoDa6p0w2tvZNiG",
  ...LEGACY_BOGO_PAYMENT_LINKS,
  "plink_1T8M50BFbQoDa6p0UWptUJKq",
  "plink_1T8MBhBFbQoDa6p0y9whMizD",
  "plink_1THnvbBFbQoDa6p05T3MWuig",
  "plink_1THnmzBFbQoDa6p0Be0SlvMI"
]);

const LANGUAGE_TO_PRODUCT: Record<string, string> = {
  french: "French",
  spanish: "Spanish",
  german: "German",
  portuguese: "Portuguese",
  italian: "Italian",
  korean: "Korean",
  japanese: "Japanese",
  mandarin: "Mandarin",
  chinese: "Mandarin",
  english: "English"
};

export const SHEET_TAB_BY_PRODUCT: Record<string, string> = {
  French: "French Steam",
  Spanish: "Spanish Steam",
  German: "German Steam",
  Portuguese: "Portuguese Steam",
  Italian: "Italian Steam",
  Korean: "Korean Steam",
  Japanese: "Japanese Steam",
  Mandarin: "Mandarin Steam",
  English: "English Steam",
  POLY_STEAM: "Polyglot Steam",
  POLY_ITCH: "Polyglot Itch"
};

interface CustomFieldLike {
  key?: string | null;
  text?: { value?: string | null } | null;
  dropdown?: { value?: string | null } | null;
  numeric?: { value?: string | null } | null;
}

export interface LegacyRoute {
  productCode: string;
  playMode: "STEAM" | "DIRECT";
  sheetTab: string;
  quantity: number;
}

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function selectedValue(field: CustomFieldLike): string {
  return field.dropdown?.value ?? field.text?.value ?? field.numeric?.value ?? "";
}

function findPlayMode(fields: CustomFieldLike[]): "STEAM" | "DIRECT" | undefined {
  const preferred = fields.find((field) => normalized(field.key).replace(/[\s_-]/g, "") === "playmode");
  const values = preferred ? [selectedValue(preferred)] : fields.map(selectedValue);
  for (const value of values) {
    const key = normalized(value);
    if (key.includes("steam")) return "STEAM";
    if (key.includes("direct") || key.includes("itch")) return "DIRECT";
  }
  return undefined;
}

function findLanguage(fields: CustomFieldLike[]): string | undefined {
  const preferred = fields.find((field) => normalized(field.key).replace(/[\s_-]/g, "") === "language");
  const values = preferred ? [selectedValue(preferred)] : fields.map(selectedValue);
  for (const value of values) {
    const key = normalized(value);
    for (const [needle, product] of Object.entries(LANGUAGE_TO_PRODUCT)) {
      if (key.includes(needle)) return product;
    }
  }
  return undefined;
}

export function paymentLinkId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") return value.id;
  return undefined;
}

export function isKnownLegacyDesktopPaymentLink(id: string | undefined): boolean {
  return Boolean(id && (LEGACY_SINGLE_LANGUAGE_PAYMENT_LINKS.has(id) || LEGACY_POLYGLOT_PAYMENT_LINKS.has(id)));
}

export function routeLegacyOrder(input: { paymentLink: unknown; customFields: unknown }): LegacyRoute | undefined {
  const linkId = paymentLinkId(input.paymentLink);
  if (!isKnownLegacyDesktopPaymentLink(linkId)) return undefined;
  const fields = Array.isArray(input.customFields) ? input.customFields as CustomFieldLike[] : [];
  const playMode = findPlayMode(fields);
  if (!playMode || !linkId) return undefined;

  let productCode: string;
  if (playMode === "DIRECT") productCode = "POLY_ITCH";
  else if (LEGACY_SINGLE_LANGUAGE_PAYMENT_LINKS.has(linkId)) {
    const language = findLanguage(fields);
    if (!language) return undefined;
    productCode = language;
  } else productCode = "POLY_STEAM";

  return {
    productCode,
    playMode,
    sheetTab: SHEET_TAB_BY_PRODUCT[productCode] ?? "",
    quantity: LEGACY_BOGO_PAYMENT_LINKS.has(linkId) ? 2 : 1
  };
}
