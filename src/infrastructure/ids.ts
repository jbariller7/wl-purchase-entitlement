import { createHash } from "node:crypto";

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableDocumentId(namespace: string, value: string): string {
  return `${namespace}_${sha256(value).slice(0, 48)}`;
}
