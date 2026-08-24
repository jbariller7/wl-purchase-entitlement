const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /(Bearer\s+)[A-Z0-9._~+/=-]+/gi;
const SECRET_PATTERN = /\b(?:sk_(?:live|test)_[A-Z0-9]+|rk_(?:live|test)_[A-Z0-9]+|whsec_[A-Z0-9]+|AIza[A-Z0-9_-]{20,})\b/gi;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/gi;

export function safeErrorMessage(error: unknown, fallback = "Operation failed"): string {
  const candidate = error as { message?: unknown };
  const raw = error instanceof Error
    ? error.message
    : typeof candidate?.message === "string"
      ? candidate.message
      : typeof error === "string" ? error : fallback;
  return raw
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(BEARER_PATTERN, "$1[redacted]")
    .replace(SECRET_PATTERN, "[redacted-secret]")
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .slice(0, 1000);
}
