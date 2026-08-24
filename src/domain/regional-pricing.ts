export type OfferPriceKind = "monthly" | "polyglot" | "premium";

/**
 * User-approved regular prices in major currency units. Storefronts that only
 * accept whole-unit or fixed-tier prices must use the nearest valid amount and
 * record the actual configured price separately.
 */
export const REGIONAL_PRICES: Record<OfferPriceKind, Readonly<Record<string, string>>> = {
  monthly: {
    USD: "6.99", GBP: "5.99", EUR: "6.49", CHF: "6.99", RUB: "227.49", PLN: "32.49",
    BRL: "18.99", JPY: "786.99", NOK: "77.99", IDR: "52458.99", MYR: "15.49", PHP: "192.49",
    SGD: "5.99", THB: "125.99", VND: "82185.00", KRW: "7344.00", UAH: "129.49", MXN: "71.99",
    CAD: "9.49", AUD: "10.49", NZD: "9.99", CNY: "23.99", INR: "279.99", CLP: "3322.00",
    PEN: "13.49", COP: "15038.00", ZAR: "57.99", HKD: "43.49", TWD: "104.99", SAR: "13.49",
    AED: "18.49", ILS: "26.49", KZT: "1626.49", KWD: "1.49", QAR: "14.49", CRC: "2780.49",
    UYU: "201.49"
  },
  polyglot: {
    USD: "31.99", GBP: "26.80", EUR: "30.99", CHF: "31.19", RUB: "1040.00", PLN: "147.99",
    BRL: "86.39", JPY: "3600.00", NOK: "356.00", IDR: "239999.20", MYR: "70.40", PHP: "880.00",
    SGD: "27.20", THB: "575.20", VND: "376000.00", KRW: "33600.00", UAH: "592.00", MXN: "327.99",
    CAD: "41.59", AUD: "46.80", NZD: "45.59", CNY: "108.80", INR: "1280.00", CLP: "15200.00",
    PEN: "61.60", COP: "68800.00", ZAR: "264.00", HKD: "198.40", TWD: "479.20", SAR: "60.76",
    AED: "84.00", ILS: "119.96", KZT: "7440.00", KWD: "5.20", QAR: "64.79", CRC: "12720.00",
    UYU: "920.00"
  },
  premium: {
    USD: "59.99", GBP: "50.25", EUR: "59.99", CHF: "58.49", RUB: "1950.00", PLN: "277.49",
    BRL: "161.99", JPY: "6750.00", NOK: "667.50", IDR: "449998.50", MYR: "132.00", PHP: "1650.00",
    SGD: "51.00", THB: "1078.50", VND: "705000.00", KRW: "63000.00", UAH: "1110.00", MXN: "614.99",
    CAD: "77.99", AUD: "87.75", NZD: "85.49", CNY: "204.00", INR: "2400.00", CLP: "28500.00",
    PEN: "115.50", COP: "129000.00", ZAR: "495.00", HKD: "372.00", TWD: "898.50", SAR: "113.93",
    AED: "157.50", ILS: "224.93", KZT: "13950.00", KWD: "9.75", QAR: "121.49", CRC: "23850.00",
    UYU: "1725.00"
  }
};

export const ZERO_DECIMAL_CURRENCIES = new Set(["CLP", "JPY", "KRW", "VND"]);

export function currencyFractionDigits(currency: string): 0 | 2 {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function stripeMinorAmount(currency: string, majorAmount: string): number {
  const normalizedCurrency = currency.toUpperCase();
  const value = Number(majorAmount);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${normalizedCurrency} price.`);
  return ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency) ? Math.round(value) : Math.round(value * 100);
}

export function stripeMajorAmount(currency: string, minorAmount: number): string {
  if (!Number.isSafeInteger(minorAmount) || minorAmount < 0) throw new Error("Invalid Stripe minor-unit amount.");
  const digits = currencyFractionDigits(currency);
  return (minorAmount / (digits === 0 ? 1 : 100)).toFixed(digits);
}

export function stripeMajorValue(currency: string, minorAmount: number): number {
  return Number(stripeMajorAmount(currency, minorAmount));
}
