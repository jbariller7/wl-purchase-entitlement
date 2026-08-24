import { HttpError } from "./auth.js";
import { safeErrorMessage } from "../infrastructure/safe-error.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export function json(statusCode: number, body: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function errorResponse(error: unknown): ReturnType<typeof json> {
  if (error instanceof HttpError) return json(error.status, { error: error.message });
  console.error("Unhandled request error", safeErrorMessage(error));
  return json(500, { error: "Internal server error" });
}

export function parseJsonBody(body: string | null): unknown {
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw new HttpError(400, "The request body must be valid JSON."); }
}
