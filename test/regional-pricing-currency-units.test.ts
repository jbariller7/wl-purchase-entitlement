import { describe, expect, it } from "vitest";
import { currencyFractionDigits, stripeMajorAmount, stripeMinorAmount } from "../src/domain/regional-pricing.js";

describe("Stripe currency units", () => {
  it("uses three decimal places for Kuwaiti dinars", () => {
    expect(currencyFractionDigits("kwd")).toBe(3);
    expect(stripeMinorAmount("KWD", "9.75")).toBe(9750);
    expect(stripeMinorAmount("KWD", "5.20")).toBe(5200);
    expect(stripeMajorAmount("KWD", 9750)).toBe("9.750");
  });
  it("preserves ordinary and zero-decimal currency handling", () => {
    expect(stripeMinorAmount("CHF", "58.49")).toBe(5849);
    expect(stripeMinorAmount("JPY", "6750")).toBe(6750);
    expect(stripeMajorAmount("USD", 5999)).toBe("59.99");
    expect(stripeMajorAmount("KRW", 63000)).toBe("63000");
  });
});
