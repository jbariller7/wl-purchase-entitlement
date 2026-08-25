import { createPrivateKey } from "node:crypto";

const PRIVATE_KEY_ERROR = "Invalid Firebase Admin private-key configuration. Replace FIREBASE_PRIVATE_KEY with the private_key PEM from the matching service-account JSON.";

function decodeQuotedString(value: string): string {
  let decoded = value.trim();
  for (let attempt = 0; attempt < 2 && decoded.startsWith('"') && decoded.endsWith('"'); attempt += 1) {
    try {
      const parsed: unknown = JSON.parse(decoded);
      if (typeof parsed !== "string") break;
      decoded = parsed.trim();
    } catch {
      break;
    }
  }
  return decoded;
}

export function normalizeGoogleServiceAccountPrivateKey(value: string): string {
  const decoded = decodeQuotedString(value)
    .replace(/\\+r\\+n/g, "\n")
    .replace(/\\+n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
  const match = decoded.match(/^-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----$/);
  const body = match?.[1]?.replace(/\s+/g, "") ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body) || body.length % 4 !== 0) throw new Error(PRIVATE_KEY_ERROR);

  const lines = body.match(/.{1,64}/g);
  if (!lines?.length) throw new Error(PRIVATE_KEY_ERROR);
  const normalized = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  try {
    createPrivateKey(normalized);
  } catch {
    throw new Error(PRIVATE_KEY_ERROR);
  }
  return normalized;
}
