import { readFileSync } from "node:fs";
import { runInContext, createContext, type Context } from "node:vm";
import { TextDecoder } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("integrations/rmmz/WonderLangDesktopAccountBridge.js", "utf8");
const projectId = "wonderlang-entitlements-9590f";
const apiKey = "test-public-firebase-api-key-123456";
const refreshToken = "test-refresh-token-that-is-long-enough";

function jwt(uid: string, expiresAtMs: number): string {
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    exp: Math.floor(expiresAtMs / 1000)
  })}.test-signature`;
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

interface Harness {
  context: Context & { WLAccountManager: Record<string, (...args: unknown[]) => unknown> };
  events: Array<{ type: string; detail: Record<string, unknown> }>;
  opened: string[];
  tokens: string[];
  files: Map<string, string>;
  fetchMock: ReturnType<typeof vi.fn>;
}

function harness(fetchMock: ReturnType<typeof vi.fn>, files = new Map<string, string>()): Harness {
  const events: Array<{ type: string; detail: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const tokens: string[] = [];
  const fsMock = {
    stat(path: string, callback: (error: NodeJS.ErrnoException | null, stat?: { isFile(): boolean; size: number }) => void) {
      const value = files.get(path);
      if (value === undefined) {
        const error = Object.assign(new Error("missing"), { code: "ENOENT" });
        callback(error);
      } else callback(null, { isFile: () => true, size: Buffer.byteLength(value) });
    },
    readFile(path: string, _encoding: string, callback: (error: Error | null, value?: string) => void) {
      const value = files.get(path);
      value === undefined ? callback(new Error("missing")) : callback(null, value);
    },
    writeFile(path: string, value: string, _options: unknown, callback: (error?: Error) => void) {
      files.set(path, value);
      callback();
    },
    chmod(_path: string, _mode: number, callback: (error?: Error) => void) { callback(); },
    unlink(path: string, callback: (error?: NodeJS.ErrnoException) => void) {
      if (files.delete(path)) callback();
      else callback(Object.assign(new Error("missing"), { code: "ENOENT" }));
    }
  };
  const windowObject: Record<string, unknown> = {
    PluginManager: { parameters: () => ({ ApiBaseUrl: "https://wl-purchase-entitlement.netlify.app" }) },
    Utils: { isNwjs: () => true },
    navigator: { userAgent: "Mozilla/5.0 NW.js Windows" },
    nw: {
      App: { dataPath: "C:\\WonderLangProfile" },
      Shell: { openExternal: (url: string) => { opened.push(url); } }
    },
    WLAccountEntitlements: {
      _nativeToken: (token: string) => { tokens.push(token); },
      _nativeSignedOut: vi.fn()
    },
    dispatchEvent: (event: { type: string; detail: Record<string, unknown> }) => {
      events.push({ type: event.type, detail: event.detail });
      return true;
    },
    CustomEvent: class {
      type: string;
      detail: Record<string, unknown>;
      constructor(type: string, init: { detail: Record<string, unknown> }) { this.type = type; this.detail = init.detail; }
    },
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: fetchMock,
    console: { warn: vi.fn(), log: vi.fn(), error: vi.fn() },
    process: { platform: "win32" },
    require: (name: string) => {
      if (name === "fs") return fsMock;
      if (name === "path") return { join: (...parts: string[]) => parts.join("\\") };
      if (name === "nw.gui") return windowObject.nw;
      if (name === "buffer") return { Buffer };
      throw new Error(`Unexpected module ${name}`);
    }
  };
  windowObject.window = windowObject;
  windowObject.globalThis = windowObject;
  const context = createContext(windowObject) as Harness["context"];
  runInContext(source, context, { filename: "WonderLangDesktopAccountBridge.js" });
  return { context, events, opened, tokens, files, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WonderLang PC/Mac account bridge", () => {
  it("completes code approval without exposing the polling secret or custom token to the UI", async () => {
    vi.useFakeTimers();
    const idToken = jwt("uid-desktop", Date.now() + 60 * 60 * 1000);
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith("/api/v1/device-sign-in/config")) return response(200, { firebaseApiKey: apiKey, firebaseProjectId: projectId });
      if (url.endsWith("/api/v1/device-sign-in/start")) return response(201, {
        userCode: "ABCD-2345",
        pollSecret: "A".repeat(43),
        verificationUrl: "https://wl-purchase-entitlement.netlify.app/account/?device_code=ABCD-2345",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        intervalSeconds: 3
      });
      if (url.endsWith("/api/v1/device-sign-in/poll")) return response(200, { state: "authorized", customToken: "custom-token-value-that-is-long-enough" });
      if (url.startsWith("https://identitytoolkit.googleapis.com/")) return response(200, { idToken, refreshToken, expiresIn: "3600" });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = harness(fetchMock);

    expect(result.context.WLAccountManager.openSignIn!()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.events.some(event => event.detail.state === "pending" && event.detail.userCode === "ABCD-2345")).toBe(true);
    expect(result.opened).toEqual(["https://wl-purchase-entitlement.netlify.app/account/?device_code=ABCD-2345"]);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(result.events.some(event => event.detail.state === "authorized")).toBe(true);
    expect(result.tokens).toEqual([idToken]);
    expect(result.context.WLAccountManager.getCachedIdToken!()).toBe(idToken);
    expect([...result.files.values()].join("\n")).toContain(refreshToken);
    expect([...result.files.values()].join("\n")).not.toContain("custom-token-value");
    expect(JSON.stringify(result.events)).not.toContain("A".repeat(43));
    expect(JSON.stringify(result.events)).not.toContain("custom-token-value");
    expect(source).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
  });

  it("restores a saved refresh token, rotates it, and erases it on sign-out", async () => {
    vi.useFakeTimers();
    const sessionPath = "C:\\WonderLangProfile\\wonderlang-account-session-v1.json";
    const files = new Map([[sessionPath, JSON.stringify({ version: 1, refreshToken })]]);
    const rotated = `${refreshToken}-rotated`;
    const idToken = jwt("uid-restored", Date.now() + 60 * 60 * 1000);
    const fetchMock = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith("/api/v1/device-sign-in/config")) return response(200, { firebaseApiKey: apiKey, firebaseProjectId: projectId });
      if (url.startsWith("https://securetoken.googleapis.com/")) return response(200, {
        id_token: idToken,
        refresh_token: rotated,
        expires_in: "3600"
      });
      throw new Error(`Unexpected URL ${url}`);
    });
    const result = harness(fetchMock, files);

    expect(result.context.WLAccountManager.refreshIdToken!()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.tokens).toEqual([idToken]);
    expect(files.get(sessionPath)).toContain(rotated);

    expect(result.context.WLAccountManager.signOut!()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(files.has(sessionPath)).toBe(false);
    expect(result.tokens.at(-1)).toBe("");
  });
});
