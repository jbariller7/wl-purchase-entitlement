/*:
 * @target MZ
 * @plugindesc Secure PC/Mac device-code sign-in bridge for WonderLang accounts (duplicate test integration).
 * @author WonderLang
 *
 * @param ApiBaseUrl
 * @text Account API URL
 * @type string
 * @default https://wl-purchase-entitlement.netlify.app
 *
 * @help
 * Load this plugin before WonderLangAccountCloudSync in a duplicated PC/Mac test
 * build. It is inactive in browsers, Android, and iOS, and it never embeds a
 * Firebase API key or private credential in the game files.
 *
 * Sign-in uses a short code that the player explicitly approves in their normal
 * web browser. The polling secret and one-time Firebase custom token remain in
 * memory. Only the Firebase refresh token is retained in NW.js's per-user app-data
 * directory with user-only file permissions where the operating system supports
 * them. Sign out and server-side session revocation invalidate the retained session.
 */
(() => {
  "use strict";

  const pluginName = "WonderLangDesktopAccountBridge";
  const params = PluginManager.parameters(pluginName);
  const apiBase = String(params.ApiBaseUrl || "https://wl-purchase-entitlement.netlify.app").replace(/\/$/, "");
  const SESSION_FILENAME = "wonderlang-account-session-v1.json";
  const TOKEN_SKEW_MS = 60_000;
  const REQUEST_TIMEOUT_MS = 20_000;
  const MAX_SESSION_FILE_BYTES = 16 * 1024;

  if (!/^https:\/\//i.test(apiBase)) throw new Error("WonderLang account API must use HTTPS.");
  if (window.WLAccountManager) return;
  if (!isDesktopNwjs()) return;

  let cachedIdToken = "";
  let cachedIdTokenExpiresAt = 0;
  let cachedRefreshToken = "";
  let firebaseApiKey = "";
  let firebaseProjectId = "";
  let loadPromise = null;
  let refreshPromise = null;
  let activeAttempt = null;
  let attemptSequence = 0;
  let storageGeneration = 0;

  class BridgeError extends Error {
    constructor(message, status = 0, code = "") {
      super(message);
      this.name = "BridgeError";
      this.status = status;
      this.code = code;
    }
  }

  function isDesktopNwjs() {
    try {
      const nwjs = typeof Utils !== "undefined" && typeof Utils.isNwjs === "function"
        ? Utils.isNwjs()
        : Boolean(window.nw || globalThis.nw);
      const userAgent = String(navigator.userAgent || "");
      return nwjs && !/Android|iPad|iPhone|iPod/i.test(userAgent) && !window.AndroidManager && !window.WLiOSManager;
    } catch (_) {
      return false;
    }
  }

  function safeMessage(error, fallback = "WonderLang account sign-in could not be completed.") {
    return String(error?.message || fallback).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 300) || fallback;
  }

  function emit(state, detail = {}) {
    window.dispatchEvent(new CustomEvent("wl-device-sign-in-state", {
      detail: { state, ...detail }
    }));
  }

  function nodeModule(name) {
    if (typeof require !== "function") throw new BridgeError("This PC/Mac build does not provide the required NW.js account storage.");
    return require(name);
  }

  function appDataPath() {
    const direct = window.nw?.App?.dataPath || globalThis.nw?.App?.dataPath;
    if (direct) return String(direct);
    try { return String(nodeModule("nw.gui")?.App?.dataPath || ""); }
    catch (_) { return ""; }
  }

  function sessionFilePath() {
    const root = appDataPath();
    if (!root) throw new BridgeError("This PC/Mac build could not locate its private account storage directory.");
    return nodeModule("path").join(root, SESSION_FILENAME);
  }

  function readFile(path) {
    const fs = nodeModule("fs");
    return new Promise((resolve, reject) => {
      fs.stat(path, (statError, stat) => {
        if (statError?.code === "ENOENT") { resolve(null); return; }
        if (statError) { reject(statError); return; }
        if (!stat.isFile() || stat.size > MAX_SESSION_FILE_BYTES) {
          reject(new BridgeError("The saved WonderLang account session is invalid."));
          return;
        }
        fs.readFile(path, "utf8", (error, value) => error ? reject(error) : resolve(value));
      });
    });
  }

  function writeFile(path, value) {
    const fs = nodeModule("fs");
    return new Promise((resolve, reject) => {
      fs.writeFile(path, value, { encoding: "utf8", mode: 0o600 }, error => {
        if (error) { reject(error); return; }
        if (typeof process !== "undefined" && process.platform !== "win32") {
          fs.chmod(path, 0o600, chmodError => chmodError ? reject(chmodError) : resolve());
        } else resolve();
      });
    });
  }

  function deleteFile(path) {
    const fs = nodeModule("fs");
    return new Promise((resolve, reject) => {
      fs.unlink(path, error => error && error.code !== "ENOENT" ? reject(error) : resolve());
    });
  }

  async function loadPersistedSession() {
    if (!loadPromise) {
      const generation = storageGeneration;
      loadPromise = (async () => {
        const raw = await readFile(sessionFilePath());
        if (!raw) return;
        let value;
        try { value = JSON.parse(raw); }
        catch (_) { throw new BridgeError("The saved WonderLang account session is invalid."); }
        const refreshToken = String(value?.refreshToken || "");
        if (value?.version !== 1 || refreshToken.length < 20 || refreshToken.length > 4096) {
          throw new BridgeError("The saved WonderLang account session is invalid.");
        }
        if (generation === storageGeneration) cachedRefreshToken = refreshToken;
      })().catch(async error => {
        try { await deleteFile(sessionFilePath()); }
        catch (_) { /* The original storage error is more useful to the player. */ }
        throw error;
      });
    }
    return loadPromise;
  }

  async function persistRefreshToken() {
    if (!cachedRefreshToken) {
      await deleteFile(sessionFilePath());
      return;
    }
    await writeFile(sessionFilePath(), JSON.stringify({
      version: 1,
      refreshToken: cachedRefreshToken
    }));
  }

  function decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new BridgeError("Firebase returned an invalid account token.");
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    try {
      const binary = typeof atob === "function" ? atob(padded) : nodeModule("buffer").Buffer.from(padded, "base64").toString("binary");
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      throw new BridgeError("Firebase returned an invalid account token.");
    }
  }

  function validateIdToken(token) {
    const claims = decodeJwtPayload(token);
    const expiresAt = Number(claims.exp) * 1000;
    if (!firebaseProjectId || claims.aud !== firebaseProjectId || claims.iss !== `https://securetoken.google.com/${firebaseProjectId}`) {
      throw new BridgeError("Firebase returned a token for a different WonderLang project.");
    }
    if (!claims.sub || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + TOKEN_SKEW_MS) {
      throw new BridgeError("Firebase returned an expired or incomplete account token.");
    }
    return { expiresAt, uid: String(claims.sub) };
  }

  function errorDetails(payload, status) {
    const raw = String(payload?.error?.message || payload?.error || payload?.message || "");
    const code = raw.split(":")[0].trim().slice(0, 80);
    const source = /^[A-Z0-9_]+$/.test(code) ? code.replace(/_/g, " ").toLowerCase() : raw;
    const friendly = source.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/[.!?]+$/, "").slice(0, 240);
    return new BridgeError(
      friendly ? `WonderLang account request failed: ${friendly}.` : `WonderLang account request failed (${status}).`,
      status,
      code
    );
  }

  async function requestJson(url, options = {}) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, ...(controller ? { signal: controller.signal } : {}) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw errorDetails(payload, response.status);
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") throw new BridgeError("The WonderLang account request timed out.");
      if (error instanceof BridgeError) throw error;
      throw new BridgeError("WonderLang could not reach the secure account service.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function ensureFirebaseConfig() {
    if (firebaseApiKey && firebaseProjectId) return;
    const result = await requestJson(`${apiBase}/api/v1/device-sign-in/config`);
    const apiKey = String(result.firebaseApiKey || "");
    const projectId = String(result.firebaseProjectId || "");
    if (apiKey.length < 20 || apiKey.length > 256 || !/^[a-z][a-z0-9-]{4,29}$/.test(projectId)) {
      throw new BridgeError("PC/Mac sign-in configuration is incomplete.");
    }
    firebaseApiKey = apiKey;
    firebaseProjectId = projectId;
  }

  async function acceptFirebaseSession(result, previousRefreshToken = "") {
    const idToken = String(result.idToken || result.id_token || "");
    const refreshToken = String(result.refreshToken || result.refresh_token || previousRefreshToken || "");
    if (refreshToken.length < 20 || refreshToken.length > 4096) {
      throw new BridgeError("Firebase returned an incomplete account session.");
    }
    const verified = validateIdToken(idToken);
    cachedIdToken = idToken;
    cachedIdTokenExpiresAt = verified.expiresAt;
    cachedRefreshToken = refreshToken;
    await persistRefreshToken();
    window.WLAccountEntitlements?._nativeToken?.(cachedIdToken);
    window.dispatchEvent(new CustomEvent("wl-desktop-auth-state", {
      detail: { signedIn: true, uid: verified.uid, expiresAt: new Date(verified.expiresAt).toISOString() }
    }));
  }

  function terminalRefreshFailure(error) {
    return ["TOKEN_EXPIRED", "USER_DISABLED", "USER_NOT_FOUND", "INVALID_REFRESH_TOKEN", "PROJECT_NUMBER_MISMATCH"]
      .includes(String(error?.code || "").toUpperCase());
  }

  async function clearSession(notify = true) {
    storageGeneration += 1;
    cachedIdToken = "";
    cachedIdTokenExpiresAt = 0;
    cachedRefreshToken = "";
    let storageError = null;
    try { await deleteFile(sessionFilePath()); }
    catch (error) { storageError = error; }
    if (notify) {
      window.WLAccountEntitlements?._nativeToken?.("");
      window.WLAccountEntitlements?._nativeSignedOut?.();
      window.dispatchEvent(new CustomEvent("wl-desktop-auth-state", { detail: { signedIn: false } }));
    }
    if (storageError) throw new BridgeError("WonderLang signed out for this run but could not erase the saved PC/Mac session.");
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await loadPersistedSession();
      if (!cachedRefreshToken) throw new BridgeError("Sign in to your WonderLang account first.", 401, "NO_SESSION");
      await ensureFirebaseConfig();
      const previous = cachedRefreshToken;
      try {
        const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: previous });
        const result = await requestJson(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(firebaseApiKey)}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString()
        });
        await acceptFirebaseSession(result, previous);
        return cachedIdToken;
      } catch (error) {
        if (terminalRefreshFailure(error)) await clearSession(true);
        throw error;
      }
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function exchangeCustomToken(customToken, sequence) {
    await ensureFirebaseConfig();
    const token = String(customToken || "");
    if (token.length < 20 || token.length > 8192) throw new BridgeError("WonderLang returned an invalid one-time sign-in token.");
    const result = await requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(firebaseApiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, returnSecureToken: true })
    });
    if (sequence !== attemptSequence) return false;
    await acceptFirebaseSession(result);
    return true;
  }

  function sleep(milliseconds, sequence) {
    return new Promise((resolve, reject) => {
      setTimeout(() => sequence === attemptSequence ? resolve() : reject(new BridgeError("Device sign-in was cancelled.", 0, "CANCELLED")), milliseconds);
    });
  }

  function validateDeviceSession(result) {
    const userCode = String(result.userCode || "");
    const pollSecret = String(result.pollSecret || "");
    const verificationUrl = String(result.verificationUrl || "");
    const expiresAt = String(result.expiresAt || "");
    const intervalSeconds = Math.max(3, Math.min(15, Number(result.intervalSeconds) || 3));
    if (!/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(userCode) ||
        !/^[A-Za-z0-9_-]{43}$/.test(pollSecret) ||
        !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
      throw new BridgeError("WonderLang returned an invalid device sign-in session.");
    }
    try {
      if (new URL(verificationUrl).protocol !== "https:") throw new Error("not https");
    } catch (_) {
      throw new BridgeError("WonderLang returned an unsafe device approval URL.");
    }
    return { userCode, pollSecret, verificationUrl, expiresAt, intervalSeconds };
  }

  function publicAttempt(attempt) {
    return {
      userCode: attempt.userCode,
      verificationUrl: attempt.verificationUrl,
      expiresAt: attempt.expiresAt
    };
  }

  function desktopDeviceLabel() {
    const platform = typeof process !== "undefined" && process.platform === "darwin" ? "Mac" : "PC";
    return `WonderLang ${platform}`;
  }

  async function beginDeviceSignIn() {
    if (activeAttempt && activeAttempt.sequence === attemptSequence) {
      emit("pending", publicAttempt(activeAttempt));
      openExternalUrl(activeAttempt.verificationUrl);
      return;
    }
    const sequence = ++attemptSequence;
    emit("starting");
    try {
      const [, started] = await Promise.all([
        ensureFirebaseConfig(),
        requestJson(`${apiBase}/api/v1/device-sign-in/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceLabel: desktopDeviceLabel() })
        })
      ]);
      if (sequence !== attemptSequence) return;
      activeAttempt = { ...validateDeviceSession(started), sequence };
      emit("pending", publicAttempt(activeAttempt));
      openExternalUrl(activeAttempt.verificationUrl);
      while (sequence === attemptSequence) {
        if (Date.parse(activeAttempt.expiresAt) <= Date.now()) {
          throw new BridgeError("This device sign-in code expired. Start again.", 410, "EXPIRED");
        }
        await sleep(activeAttempt.intervalSeconds * 1000, sequence);
        const result = await requestJson(`${apiBase}/api/v1/device-sign-in/poll`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userCode: activeAttempt.userCode, pollSecret: activeAttempt.pollSecret })
        });
        if (sequence !== attemptSequence) return;
        if (result.state === "pending") {
          activeAttempt.intervalSeconds = Math.max(activeAttempt.intervalSeconds, Math.min(15, Number(result.retryAfterSeconds) || 3));
          continue;
        }
        if (result.state !== "authorized") throw new BridgeError("WonderLang returned an unknown device sign-in state.");
        if (!await exchangeCustomToken(result.customToken, sequence)) return;
        if (sequence !== attemptSequence) return;
        activeAttempt = null;
        emit("authorized");
        return;
      }
    } catch (error) {
      if (sequence !== attemptSequence || error?.code === "CANCELLED") return;
      activeAttempt = null;
      emit("error", { message: safeMessage(error) });
    }
  }

  function openExternalUrl(rawUrl) {
    let url;
    try {
      url = new URL(String(rawUrl || ""));
      if (url.protocol !== "https:") return false;
    } catch (_) { return false; }
    try {
      const shell = window.nw?.Shell || globalThis.nw?.Shell || nodeModule("nw.gui")?.Shell;
      if (!shell?.openExternal) return false;
      shell.openExternal(url.toString());
      return true;
    } catch (_) { return false; }
  }

  window.WLAccountManager = {
    getCachedIdToken() {
      return cachedIdToken && cachedIdTokenExpiresAt > Date.now() + TOKEN_SKEW_MS ? cachedIdToken : "";
    },
    getAccountSnapshot() { return ""; },
    isSignedInFromGame() { return Boolean(cachedRefreshToken || cachedIdToken); },
    openAccount() { return openExternalUrl(`${apiBase}/account/`); },
    openSignIn() { beginDeviceSignIn(); return true; },
    cancelSignIn() {
      attemptSequence += 1;
      activeAttempt = null;
      emit("cancelled");
      return true;
    },
    refreshEntitlements() { return this.refreshIdToken(); },
    refreshIdToken() {
      if (cachedIdToken && cachedIdTokenExpiresAt > Date.now() + TOKEN_SKEW_MS) {
        window.WLAccountEntitlements?._nativeToken?.(cachedIdToken);
        return true;
      }
      refreshSession().catch(error => {
        if (error?.code !== "NO_SESSION") console.warn("[WonderLang Account] Token refresh failed.", safeMessage(error));
        window.WLAccountEntitlements?._nativeToken?.("");
      });
      return true;
    },
    openExternalUrl,
    signOut() {
      attemptSequence += 1;
      activeAttempt = null;
      clearSession(true).catch(error => console.warn("[WonderLang Account] Local sign-out cleanup failed.", safeMessage(error)));
      return true;
    }
  };

  loadPersistedSession().catch(error => {
    console.warn("[WonderLang Account] Saved PC/Mac session was discarded.", safeMessage(error));
  });
})();
