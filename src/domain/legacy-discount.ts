export interface LegacyDiscountClaim {
  uid: string;
  verifiedDesktopTransactionIds: string[];
  redeemedAt?: string;
  reservedCheckoutSessionId?: string;
  reservationExpiresAt?: string;
}

export function canUseLegacyLifetimeDiscount(claim: LegacyDiscountClaim, now: Date): boolean {
  if (claim.verifiedDesktopTransactionIds.length === 0 || claim.redeemedAt) return false;
  if (!claim.reservedCheckoutSessionId) return true;
  return !claim.reservationExpiresAt || Date.parse(claim.reservationExpiresAt) <= now.getTime();
}

export function assertLegacyLifetimeDiscountAvailable(claim: LegacyDiscountClaim, now: Date): void {
  if (!canUseLegacyLifetimeDiscount(claim, now)) {
    throw new Error("The verified desktop-customer lifetime discount is unavailable or already used.");
  }
}
