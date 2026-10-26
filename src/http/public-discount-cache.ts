// Public presentation only. Checkout always revalidates against Firestore.
export function publicDiscountHeaders(expiresAt: Array<string | null | undefined>, now = Date.now()) {
  const remaining = expiresAt.filter((v): v is string => Boolean(v))
    .map(v => Math.floor((Date.parse(v) - now) / 1000)).filter(Number.isFinite);
  const ttl = Math.max(0, Math.min(60, ...remaining));
  return {
    'cache-control': 'public, max-age=0, must-revalidate',
    'netlify-cdn-cache-control': ttl ? `public, max-age=${ttl}, must-revalidate` : 'no-store',
    'netlify-vary': 'query=placement|id',
    'x-discount-cache-seconds': String(ttl)
  };
}
