import { describe, expect, it } from "vitest";
import { parseRegisteredWebsiteCheckout, WEBSITE_BASE_LANGUAGE_LOCALES } from "../src/legacy/website-checkout-contract.js";
const registration = [{paymentLinkId:"plink_premium",priceId:"price_premium",locale:"fr",offer:"premium" as const}];
const fields = [{key:"playmode",dropdown:{value:"steam"}},{key:"mobileplatform",dropdown:{value:"later"}}];
describe("registered localized website checkout contract", () => {
  it("covers all 24 game base-language sections", () => { expect(Object.keys(WEBSITE_BASE_LANGUAGE_LOCALES)).toHaveLength(24); expect(new Set(Object.values(WEBSITE_BASE_LANGUAGE_LOCALES)).size).toBe(20); });
  it("parses stable values without trusting labels or guessing the mobile platform", () => {
    expect(parseRegisteredWebsiteCheckout({paymentLinkId:"plink_premium",priceId:"price_premium",customFields:fields},registration)).toMatchObject({offer:"premium",delivery:"steam",mobilePlatform:"later"});
  });
  it("rejects incorrect prices and duplicate fields", () => {
    expect(()=>parseRegisteredWebsiteCheckout({paymentLinkId:"plink_premium",priceId:"price_other",customFields:fields},registration)).toThrow(/price/);
    expect(()=>parseRegisteredWebsiteCheckout({paymentLinkId:"plink_premium",priceId:"price_premium",customFields:[...fields,fields[0]]},registration)).toThrow(/duplicated/);
  });
  it("does not accept arbitrary payment links", () => {
    expect(parseRegisteredWebsiteCheckout({paymentLinkId:"plink_unknown",priceId:"price_premium",customFields:fields},registration)).toBeUndefined();
  });
});
