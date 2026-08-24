import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;

interface KeyRingDocument {
  current: string;
  keys: Record<string, string>;
}

export interface EncryptedProviderToken {
  algorithm: typeof ALGORITHM;
  keyId: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

function keyRing(): { current: string; keys: Map<string, Buffer> } {
  const raw = env().PROVIDER_TOKEN_ENCRYPTION_KEYS;
  if (!raw) throw new Error("Provider token encryption is not configured.");
  let document: KeyRingDocument;
  try {
    document = JSON.parse(raw) as KeyRingDocument;
  } catch {
    throw new Error("Provider token encryption key ring is invalid JSON.");
  }
  if (!document || typeof document.current !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(document.current)) {
    throw new Error("Provider token encryption key ring has an invalid current key ID.");
  }
  if (!document.keys || typeof document.keys !== "object" || Array.isArray(document.keys)) {
    throw new Error("Provider token encryption key ring has no keys.");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(document.keys)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(keyId) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error("Provider token encryption key ring contains an invalid entry.");
    }
    const key = Buffer.from(encoded, "base64");
    if (key.byteLength !== KEY_BYTES) throw new Error("Provider token encryption keys must contain exactly 32 bytes.");
    keys.set(keyId, key);
  }
  if (!keys.has(document.current)) throw new Error("Provider token encryption current key is missing.");
  return { current: document.current, keys };
}

export function assertProviderTokenEncryptionConfigured(): void {
  keyRing();
}

export function encryptProviderToken(plaintext: string, associatedData: string): EncryptedProviderToken {
  if (!plaintext) throw new Error("Provider token is empty.");
  const ring = keyRing();
  const key = ring.keys.get(ring.current);
  if (!key) throw new Error("Provider token encryption current key is missing.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    algorithm: ALGORITHM,
    keyId: ring.current,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  };
}

export function decryptProviderToken(value: EncryptedProviderToken, associatedData: string): string {
  if (value.algorithm !== ALGORITHM) throw new Error("Provider token uses an unsupported encryption algorithm.");
  const key = keyRing().keys.get(value.keyId);
  if (!key) throw new Error("Provider token encryption key is unavailable.");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(value.iv, "base64"));
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new Error("Provider token authentication failed.");
  }
}
