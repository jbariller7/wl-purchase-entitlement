import { HttpError } from "./auth.js";

export function requestHeader(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) return value;
  }
  return undefined;
}

export function apiAllowedOrigins(includeAndroidWebView: boolean): Set<string> {
  return new Set([
    ...(process.env.PUBLIC_APP_ORIGIN ? [process.env.PUBLIC_APP_ORIGIN] : []),
    "https://wonderlang.net",
    "https://www.wonderlang.net",
    ...(includeAndroidWebView ? ["https://appassets.local"] : [])
  ]);
}

/**
 * CORS response headers do not prevent an untrusted browser from sending a
 * request. Reject a present, untrusted Origin before authentication or any
 * mutation. Native clients legitimately omit Origin and remain supported.
 */
export function requireAllowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): void {
  if (origin && !allowed.has(origin)) {
    throw new HttpError(403, "This browser origin is not allowed to call the WonderLang service.");
  }
}
