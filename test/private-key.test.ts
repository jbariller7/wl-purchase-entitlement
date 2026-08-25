import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeGoogleServiceAccountPrivateKey } from "../src/infrastructure/private-key.js";

const pem = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

describe("Firebase Admin private-key normalization", () => {
  it.each([
    ["multiline PEM", pem],
    ["escaped newlines", pem.replace(/\n/g, "\\n")],
    ["JSON-quoted PEM", JSON.stringify(pem)],
    ["flattened PEM", pem.replace(/\n/g, " ")]
  ])("accepts a valid %s", (_label, input) => {
    expect(normalizeGoogleServiceAccountPrivateKey(input)).toBe(pem);
  });

  it("rejects malformed material without echoing it", () => {
    const secret = "not-a-private-key-secret";
    expect(() => normalizeGoogleServiceAccountPrivateKey(secret)).toThrow("Invalid Firebase Admin private-key configuration.");
    try {
      normalizeGoogleServiceAccountPrivateKey(secret);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
