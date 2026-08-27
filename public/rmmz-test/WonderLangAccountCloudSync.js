/*:
 * @target MZ
 * @plugindesc WonderLang account UI, six save profiles, and automatic whole-profile cloud sync (test integration).
 * @author WonderLang
 *
 * @param ApiBaseUrl
 * @text Account API URL
 * @type string
 * @default https://wl-purchase-entitlement.netlify.app
 *
 * @param OpenOnPlaytest
 * @text Open account automatically in playtest
 * @type boolean
 * @on Yes
 * @off No
 * @default false
 *
 * @command openAccount
 * @text Open WonderLang Account
 * @desc Shows sign-in state, access, subscription, cloud saves, and account actions.
 *
 * @command openCloudSaves
 * @text Manage Save Profiles
 * @desc Selects, creates, and renames complete cloud-save profiles.
 *
 * @command refreshEntitlements
 * @text Refresh Entitlements
 * @desc Refreshes the signed-in player's server-authoritative access snapshot.
 *
 * @help
 * Duplicate/test-build integration. Keep production WonderLang files untouched until
 * this copy has passed the Android release gate and real-device testing.
 *
 * Native bridge name: WLAccountManager
 *   getCachedIdToken(), getCachedAppCheckToken(), refreshIdToken(), openSignIn(), openAccount(),
 *   openExternalUrl(url), and Firebase-auth callbacks documented below.
 *
 * Every selected profile contains global.rmmzsave and every file0-file20 save.
 * Local saves finish first, then the complete profile synchronizes automatically.
 * A revision conflict never overwrites either side without asking the player.
 * Android offline access is authorized only by a Firebase-UID-bound AES-GCM lease in
 * Android Keystore: Monthly lasts at most seven days and never beyond the known paid/grace
 * deadline; permanent and Premium access require an online recheck every 30 days.
 * Desktop verified permanent/Premium access remains available offline. Its cached Monthly
 * snapshot remains usable through its paid period or for seven days after the last refresh,
 * whichever is later; provider grace access ends at the server-provided grace deadline.
 */
(() => {
  "use strict";

  const pluginName = "WonderLangAccountCloudSync";
  const params = PluginManager.parameters(pluginName);
  const apiBase = String(params.ApiBaseUrl || "https://wl-purchase-entitlement.netlify.app").replace(/\/$/, "");
  const openOnPlaytest = String(params.OpenOnPlaytest || "false").toLowerCase() === "true";
  if (!/^https:\/\//i.test(apiBase)) throw new Error("WonderLang account API must use HTTPS.");

  const cacheKey = "wl-account-entitlements-v3";
  const revisionsPrefix = "wl-cloud-revisions-v3";
  const retryPrefix = "wl-cloud-upload-retry-v3";
  const activeProfilePrefix = "wl-cloud-active-profile-v1";
  const OFFLINE_SUBSCRIPTION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const knownMobileSkus = new Set([
    "wonderlangmonthly", "wonderlangfull",
    "wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4"
  ]);
  let tokenWaiters = [];
  let current = loadJson(cacheKey, null);
  let activeOverlay = null;
  let drainingRetries = false;
  let applyingProfile = false;
  let profileSyncTimer = null;
  let profileSyncInFlight = null;
  let profileSelectionInFlight = false;

  class AccountApiError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AccountApiError";
      this.status = status;
    }
  }

  function bridge() { return window.WLAccountManager; }
  function runtimeMobilePlatform() {
    const userAgent = String(navigator.userAgent || navigator.vendor || "");
    if (window.AndroidManager || /Android/i.test(userAgent)) return "android";
    if (window.WLiOSManager || /iPad|iPhone|iPod/i.test(userAgent) ||
        (String(navigator.platform || "") === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1)) return "ios";
    return null;
  }
  function restrictToGrantedPlatform(value) {
    const platform = runtimeMobilePlatform();
    if (!value?.fullGame || !platform) return value;
    const allowedPlatforms = Array.isArray(value.mobilePlatforms) ? value.mobilePlatforms : [];
    if (allowedPlatforms.includes(platform)) return value;
    return {
      ...value,
      fullGame: false,
      allLanguages: false,
      cloudSave: false,
      platformRestricted: true
    };
  }
  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
    catch (_) { return fallback; }
  }
  function cache(value) {
    current = value;
    if (value) localStorage.setItem(cacheKey, JSON.stringify({ ...value, _cachedAt: Date.now() }));
    else localStorage.removeItem(cacheKey);
  }
  function nativeAndroidAccount() {
    if (runtimeMobilePlatform() !== "android") return undefined;
    const nativeBridge = bridge();
    if (!nativeBridge || typeof nativeBridge.getAccountSnapshot !== "function") return null;
    try {
      const snapshot = String(nativeBridge.getAccountSnapshot() || "");
      return snapshot ? JSON.parse(snapshot) : null;
    } catch (_) {
      return null;
    }
  }
  function authoritativeAccount() {
    const native = nativeAndroidAccount();
    // On Android, localStorage is never an entitlement authority. Only the
    // native bridge can expose an online snapshot or a keystore-validated lease.
    return native === undefined ? current : native;
  }
  function accountUid() { return String(authoritativeAccount()?.uid || "signed-out"); }
  function revisionsKey() { return `${revisionsPrefix}:${accountUid()}`; }
  function revisions() { return loadJson(revisionsKey(), {}); }
  function setRevision(slot, revision) {
    const value = revisions();
    if (revision) value[slot] = revision;
    else delete value[slot];
    localStorage.setItem(revisionsKey(), JSON.stringify(value));
  }
  function activeProfileKey() { return `${activeProfilePrefix}:${accountUid()}`; }
  function activeProfileId() { return String(localStorage.getItem(activeProfileKey()) || ""); }
  function setActiveProfileId(profileId) {
    if (profileId) localStorage.setItem(activeProfileKey(), String(profileId));
    else localStorage.removeItem(activeProfileKey());
  }
  function entitlement() { return authoritativeAccount()?.entitlements || null; }
  function effectiveCachedEntitlement(now = Date.now()) {
    const value = restrictToGrantedPlatform(entitlement());
    if (!value?.fullGame) return value;
    if (value.accessKind === "premium_lifetime" || value.accessKind === "permanent" || value.accessKind === "legacy") return value;
    if (value.accessKind !== "subscription") return value;
    const computedAt = Date.parse(value.computedAt || "");
    if (!Number.isFinite(computedAt) || computedAt > now + 5 * 60 * 1000) return { ...value, fullGame: false, allLanguages: false, cloudSave: false, offlineExpired: true };
    const deadline = value.subscriptionState === "grace"
      ? Date.parse(value.graceEndsAt || "")
      : Math.max(Date.parse(value.subscriptionEndsAt || "") || 0, computedAt + OFFLINE_SUBSCRIPTION_GRACE_MS);
    return Number.isFinite(deadline) && now < deadline
      ? value
      : { ...value, fullGame: false, allLanguages: false, cloudSave: false, offlineExpired: true };
  }
  function account() { return authoritativeAccount(); }
  function retryKey() { return `${retryPrefix}:${accountUid()}`; }
  function retryQueue() {
    const stored = loadJson(retryKey(), {});
    return Object.fromEntries(Object.entries(stored).filter(([, item]) => item && typeof item.profileId === "string"));
  }
  function retryCount() { return Object.keys(retryQueue()).length; }
  function saveRetryQueue(queue) {
    if (Object.keys(queue).length) localStorage.setItem(retryKey(), JSON.stringify(queue));
    else localStorage.removeItem(retryKey());
    window.dispatchEvent(new CustomEvent("wl-cloud-save-retry-state", { detail: { queued: Object.keys(queue).length } }));
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }
  function formatTime(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not available";
  }
  function safeMessage(error, fallback = "Something went wrong.") {
    const text = String(error?.message || fallback).trim();
    return (text || fallback).slice(0, 300);
  }

  async function idToken(forceRefresh = false) {
    const immediate = forceRefresh ? "" : String(bridge()?.getCachedIdToken?.() || "");
    if (immediate) return immediate;
    if (!bridge()?.refreshIdToken?.()) throw new Error("Sign in to your WonderLang account first.");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Account token refresh timed out.")), 15_000);
      tokenWaiters.push(token => {
        clearTimeout(timeout);
        token ? resolve(token) : reject(new Error("Account sign-in is required."));
      });
    });
  }

  async function request(path, options = {}) {
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const send = token => {
      const appCheckToken = String(bridge()?.getCachedAppCheckToken?.() || "");
      return fetch(`${apiBase}${path}`, {
        method: options.method || "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {})
        },
        ...(body ? { body } : {})
      });
    };
    let response = await send(await idToken());
    if (response.status === 401) response = await send(await idToken(true));
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new AccountApiError(response.status, result.error || `Account request failed (${response.status}).`);
    return result;
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
  }

  function ownsProduct(sku) {
    const normalized = String(sku || "").trim().toLowerCase();
    if (!knownMobileSkus.has(normalized)) return false;
    const value = effectiveCachedEntitlement();
    if (!value) return false;
    if (value.fullGame) return true;
    const chapter = /^wonderlangch([1-4])$/.exec(normalized);
    return chapter ? (value.chapters || []).includes(Number(chapter[1])) : false;
  }

  async function refresh() {
    const me = await request("/api/v1/me");
    cache(me);
    window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: me.entitlements }));
    drainUploadQueue().catch(error => console.warn("[WonderLang Cloud Save] Retry queue paused.", safeMessage(error)));
    return me.entitlements;
  }

  async function drainUploadQueue() {
    if (drainingRetries || navigator.onLine === false || !effectiveCachedEntitlement()?.cloudSave) return;
    drainingRetries = true;
    try {
      const queue = retryQueue();
      for (const item of Object.values(queue)) {
        if (Date.parse(item.notBefore || "") > Date.now()) continue;
        if (!item.profileId || item.profileId !== activeProfileId()) continue;
        try {
          await uploadProfile(item.profileId);
        } catch (error) {
          queueProfileUpload(item.profileId, error);
        }
      }
    } finally {
      drainingRetries = false;
    }
  }

  function queueProfileUpload(profileId, error) {
    if (!profileId) return;
    const queue = retryQueue();
    const previous = queue[profileId] || {};
    const attemptCount = Number(previous.attemptCount || 0) + 1;
    const delayMs = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.min(attemptCount - 1, 9)));
    queue[profileId] = {
      profileId,
      queuedAt: previous.queuedAt || new Date().toISOString(),
      attemptCount,
      notBefore: new Date(Date.now() + delayMs).toISOString(),
      changeToken: previous.changeToken || `${Date.now()}-${Math.random()}`,
      lastError: safeMessage(error)
    };
    saveRetryQueue(queue);
  }

  function markProfileDirty(profileId) {
    if (!profileId) return;
    const queue = retryQueue();
    const previous = queue[profileId] || {};
    queue[profileId] = {
      profileId,
      queuedAt: previous.queuedAt || new Date().toISOString(),
      attemptCount: Number(previous.attemptCount || 0),
      notBefore: new Date(Date.now() + 1500).toISOString(),
      changeToken: `${Date.now()}-${Math.random()}`,
      ...(previous.lastError ? { lastError: previous.lastError } : {})
    };
    saveRetryQueue(queue);
  }

  function clearQueuedProfile(profileId) {
    const queue = retryQueue();
    delete queue[profileId];
    saveRetryQueue(queue);
  }

  function managedSaveNames() {
    const maximum = Math.min(20, Math.max(1, Number(DataManager.maxSavefiles?.()) || 20));
    return ["global", ...Array.from({ length: maximum + 1 }, (_, index) => `file${index}`)];
  }

  function hasLocalPlayerSaves() {
    return managedSaveNames().some(name => name !== "global" && StorageManager.exists(name));
  }

  async function objectJson(saveName) {
    const object = saveName === "global" && !StorageManager.exists("global")
      ? (DataManager._globalInfo || [])
      : await StorageManager.loadObject(saveName);
    return StorageManager.objectToJson(object);
  }

  async function buildProfileBundle(profileId) {
    const files = {};
    for (const saveName of managedSaveNames()) {
      if (saveName !== "global" && !StorageManager.exists(saveName)) continue;
      files[saveName] = await objectJson(saveName);
    }
    if (!files.global) files.global = await StorageManager.objectToJson(DataManager._globalInfo || []);
    return {
      magic: "WL_CLOUD_PROFILE",
      version: 1,
      profileId,
      exportedAt: new Date().toISOString(),
      files
    };
  }

  function validateProfileBundle(bundle, profileId) {
    if (!bundle || bundle.magic !== "WL_CLOUD_PROFILE" || bundle.version !== 1 || bundle.profileId !== profileId ||
        !bundle.files || typeof bundle.files.global !== "string") {
      throw new Error("Downloaded cloud profile is invalid.");
    }
    const allowed = /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/;
    if (Object.keys(bundle.files).some(name => !allowed.test(name) || typeof bundle.files[name] !== "string")) {
      throw new Error("Downloaded cloud profile contains an invalid save-file set.");
    }
  }

  async function applyProfileBundle(bundle, profileId) {
    validateProfileBundle(bundle, profileId);
    applyingProfile = true;
    try {
      for (const saveName of managedSaveNames()) {
        if (StorageManager.exists(saveName)) await Promise.resolve(StorageManager.remove(saveName));
      }
      for (const [saveName, json] of Object.entries(bundle.files)) {
        const object = await StorageManager.jsonToObject(json);
        await StorageManager.saveObject(saveName, object);
      }
      DataManager._globalInfo = await StorageManager.loadObject("global");
      DataManager.removeInvalidGlobalInfo?.();
    } finally {
      applyingProfile = false;
    }
    window.dispatchEvent(new CustomEvent("wl-cloud-profile-applied", { detail: { profileId } }));
  }

  async function listProfiles() {
    return (await request("/api/v1/cloud-save-profiles")).profiles || [];
  }

  async function uploadProfile(profileId, options = {}) {
    if (!effectiveCachedEntitlement()?.cloudSave) return { skipped: "not_entitled" };
    if (!profileId || profileId !== activeProfileId()) return { skipped: "not_active" };
    const queuedChangeToken = retryQueue()[profileId]?.changeToken || null;
    const bytes = textEncoder.encode(JSON.stringify(await buildProfileBundle(profileId)));
    const baseRevision = Object.prototype.hasOwnProperty.call(options, "baseRevision")
      ? options.baseRevision
      : (revisions()[profileId] || null);
    const prepare = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/prepare-upload`, {
      method: "POST",
      body: {
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        baseRevision
      }
    });
    const upload = await fetch(prepare.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: bytes
    });
    if (!upload.ok) throw new Error(`Cloud profile upload failed (${upload.status}).`);
    try {
      const manifest = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/finalize`, {
        method: "POST",
        body: { uploadId: prepare.uploadId }
      });
      setRevision(profileId, manifest.currentRevision);
      const latestChangeToken = retryQueue()[profileId]?.changeToken || null;
      if (latestChangeToken === queuedChangeToken) clearQueuedProfile(profileId);
      window.dispatchEvent(new CustomEvent("wl-cloud-profile-synced", { detail: { profileId, manifest } }));
      return manifest;
    } catch (error) {
      if (error?.status === 409 && options.showConflict !== false) {
        await presentProfileConflict(profileId);
        return { conflict: true };
      }
      throw error;
    }
  }

  async function downloadProfile(profileId) {
    const remote = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/download`);
    const response = await fetch(remote.downloadUrl);
    if (!response.ok) throw new Error(`Cloud profile download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== remote.manifest.byteLength || await sha256Hex(bytes) !== remote.manifest.sha256) {
      throw new Error("Downloaded cloud profile failed its integrity check.");
    }
    const bundle = JSON.parse(textDecoder.decode(bytes));
    validateProfileBundle(bundle, profileId);
    return { remote, bundle };
  }

  async function restoreProfile(profileId) {
    const { remote, bundle } = await downloadProfile(profileId);
    await applyProfileBundle(bundle, profileId);
    setRevision(profileId, remote.manifest.currentRevision);
    clearQueuedProfile(profileId);
    window.dispatchEvent(new CustomEvent("wl-cloud-profile-restored", { detail: { profileId, manifest: remote.manifest } }));
    return remote.manifest;
  }

  function scheduleProfileSync() {
    if (applyingProfile || !activeProfileId() || !effectiveCachedEntitlement()?.cloudSave) return;
    markProfileDirty(activeProfileId());
    clearTimeout(profileSyncTimer);
    profileSyncTimer = setTimeout(() => {
      const profileId = activeProfileId();
      profileSyncInFlight = Promise.resolve(profileSyncInFlight).catch(() => undefined).then(() => uploadProfile(profileId));
      profileSyncInFlight.catch(error => {
        console.warn("[WonderLang Cloud Save] Local save succeeded; complete profile upload did not.", error);
        queueProfileUpload(profileId, error);
        window.dispatchEvent(new CustomEvent("wl-cloud-save-error", { detail: { profileId, message: safeMessage(error) } }));
      });
    }, 1500);
  }

  async function syncActiveProfileNow() {
    const profileId = activeProfileId();
    if (!profileId) throw new Error("Choose a save profile first.");
    clearTimeout(profileSyncTimer);
    if (profileSyncInFlight) await profileSyncInFlight.catch(() => undefined);
    return uploadProfile(profileId);
  }

  function accountTheme() {
    let theme = {};
    try {
      theme = globalThis.ColorThemeUtils?.computeThemeFromConfig?.() || {};
    } catch (_) {}
    const buttonGradient = String(theme.buttonGradient || "linear-gradient(135deg, #d9ff45 0%, #77df66 48%, #32b6a8 100%)");
    const gradientColor = buttonGradient.match(/(#[0-9a-f]{6}|#[0-9a-f]{3}|rgba?\([^)]+\))/i)?.[1];
    let fontFamily = "NotoSans";
    try {
      const fonts = globalThis.TextManager?.optionsCoreFonts || [];
      const configured = String(fonts[Number(globalThis.ConfigManager?.textFont)] || "").trim();
      if (configured && !/^(?:default|gamefont)$/i.test(configured)) fontFamily = configured;
    } catch (_) {}
    return {
      panel: String(theme.primaryBg || "rgba(9, 24, 24, .96)"),
      panelAlt: String(theme.secondaryBg || "rgba(28, 62, 51, .96)"),
      gradient: buttonGradient,
      text: String(theme.textColor || "#f8fff4"),
      highlight: String(theme.highlightColor || theme.accentColor || gradientColor || "#d9ff45"),
      fontFamily
    };
  }

  function applyAccountTheme(overlay) {
    const theme = accountTheme();
    overlay.style.setProperty("--wl-account-panel", theme.panel);
    overlay.style.setProperty("--wl-account-panel-alt", theme.panelAlt);
    overlay.style.setProperty("--wl-account-gradient", theme.gradient);
    overlay.style.setProperty("--wl-account-text", theme.text);
    overlay.style.setProperty("--wl-account-highlight", theme.highlight);
    overlay.style.setProperty("--wl-account-font", `'${theme.fontFamily.replace(/'/g, "\\'")}'`);
  }

  function ensureStyles() {
    if (document.getElementById("wl-account-styles")) return;
    const style = document.createElement("style");
    style.id = "wl-account-styles";
    style.textContent = `
      html.wl-account-ui-open #titleListUI .panel{opacity:0!important;pointer-events:none!important;transform:translateY(-50%) translateX(2rem) scale(.97)!important}
      .wl-account-overlay,.wl-account-overlay *{box-sizing:border-box;font-family:var(--wl-account-font,'NotoSans'),sans-serif!important;-webkit-text-stroke:0!important}
      .wl-account-overlay{position:fixed;inset:0;z-index:1000001;display:grid;place-items:center;padding:clamp(14px,3.5vh,42px) clamp(14px,3.5vw,54px);color:var(--wl-account-text,#f8fff4);background:radial-gradient(circle at 18% 12%,rgba(191,255,87,.14),transparent 34%),radial-gradient(circle at 84% 88%,rgba(50,182,168,.14),transparent 32%),rgba(2,10,12,.72);backdrop-filter:blur(16px) saturate(1.15);-webkit-backdrop-filter:blur(16px) saturate(1.15);animation:wl-account-backdrop-in .2s ease-out both}
      .wl-account-panel{position:relative;isolation:isolate;width:min(1040px,94vw);max-height:min(900px,92vh);display:grid;grid-template-rows:auto minmax(0,1fr) auto;overflow:hidden;border:1px solid rgba(255,255,255,.2);border-radius:clamp(18px,2.2vw,30px);background:linear-gradient(145deg,var(--wl-account-panel,rgba(9,24,24,.96)),var(--wl-account-panel-alt,rgba(28,62,51,.96)));box-shadow:0 2rem 6rem rgba(0,0,0,.56),inset 0 1px rgba(255,255,255,.12);animation:wl-account-panel-in .26s cubic-bezier(.2,.8,.2,1) both}
      .wl-account-panel::before{content:"";position:absolute;z-index:2;inset:0 0 auto;height:4px;background:var(--wl-account-gradient,linear-gradient(135deg,#d9ff45,#32b6a8))}
      .wl-account-panel::after{content:"";position:absolute;z-index:-1;width:360px;height:360px;right:-150px;top:-180px;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);filter:blur(90px);opacity:.12;pointer-events:none}
      .wl-account-header{display:flex;align-items:center;gap:16px;padding:clamp(20px,3vw,34px) clamp(20px,3.6vw,42px) 18px;border-bottom:1px solid rgba(255,255,255,.1)}
      .wl-account-mark{width:52px;height:52px;display:grid;place-items:center;flex:0 0 auto;border-radius:16px;background:var(--wl-account-gradient,linear-gradient(135deg,#d9ff45,#32b6a8));color:#102015;font-size:30px;font-weight:950;line-height:1;transform:rotate(-3deg);box-shadow:0 10px 24px rgba(0,0,0,.25),inset 0 1px rgba(255,255,255,.45)}
      .wl-account-heading{min-width:0}.wl-account-kicker{margin-bottom:4px;color:var(--wl-account-highlight,#d9ff45);font-size:11px;font-weight:900;letter-spacing:.22em;text-transform:uppercase}.wl-account-panel h2{margin:0;color:var(--wl-account-text,#fff);font-size:clamp(25px,3.5vw,38px);font-weight:900;line-height:1.05;letter-spacing:-.025em}.wl-account-trust{margin-left:auto;display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(0,0,0,.18);color:rgba(255,255,255,.76);font-size:12px;font-weight:750;white-space:nowrap}.wl-account-trust-dot{width:8px;height:8px;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 12px var(--wl-account-highlight,#d9ff45)}
      .wl-account-scroll{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--wl-account-highlight,#d9ff45) rgba(0,0,0,.18);touch-action:pan-y;-webkit-overflow-scrolling:touch}.wl-account-scroll::-webkit-scrollbar{width:8px}.wl-account-scroll::-webkit-scrollbar-thumb{border-radius:999px;background:var(--wl-account-highlight,#d9ff45)}.wl-account-content{padding:clamp(20px,3vw,36px) clamp(20px,3.6vw,42px)}
      .wl-account-panel h3{margin:0;color:var(--wl-account-text,#fff);font-size:clamp(18px,2.2vw,23px);font-weight:850;line-height:1.2}.wl-account-muted{margin:0;color:rgba(238,248,241,.7);font-size:clamp(14px,1.7vw,17px);line-height:1.58}.wl-account-muted+.wl-account-muted{margin-top:10px}
      .wl-account-identity-row{display:flex;align-items:stretch;flex-wrap:wrap;gap:10px;margin-bottom:20px}.wl-account-identity{display:flex;align-items:center;gap:12px;min-height:46px;max-width:100%;padding:10px 14px;border:1px solid rgba(255,255,255,.13);border-radius:14px;background:rgba(0,0,0,.16);color:rgba(255,255,255,.92);font-size:15px;font-weight:720}.wl-account-identity::before{content:"";width:9px;height:9px;flex:0 0 auto;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 13px var(--wl-account-highlight,#d9ff45)}.wl-account-profile-switcher{position:relative;min-height:46px;display:flex;align-items:center;gap:9px;padding:5px 38px 5px 13px;border:1px solid rgba(255,255,255,.16);border-radius:14px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.68);cursor:pointer}.wl-account-profile-switcher::after{content:"⌄";position:absolute;right:14px;top:50%;color:var(--wl-account-highlight,#d9ff45);font-size:20px;font-weight:900;line-height:1;transform:translateY(-58%);pointer-events:none}.wl-account-profile-label{font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.wl-account-profile-select{min-width:110px;max-width:230px;border:0;outline:0;appearance:none;-webkit-appearance:none;background:transparent;color:var(--wl-account-text,#fff);font-size:15px;font-weight:850;cursor:pointer}.wl-account-profile-select option{background:#13251f;color:#fff}.wl-account-profile-switcher:focus-within{border-color:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 0 3px rgba(217,255,69,.14)}
      .wl-account-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:22px 0}.wl-account-card{position:relative;min-height:106px;padding:18px 18px 16px;overflow:hidden;border:1px solid rgba(255,255,255,.13);border-radius:17px;background:linear-gradient(145deg,rgba(255,255,255,.105),rgba(0,0,0,.14));box-shadow:inset 0 1px rgba(255,255,255,.06)}.wl-account-card::after{content:"";position:absolute;width:74px;height:74px;right:-34px;bottom:-38px;border-radius:50%;background:var(--wl-account-highlight,#d9ff45);filter:blur(28px);opacity:.12}.wl-account-card b{display:block;margin-bottom:10px;color:var(--wl-account-highlight,#d9ff45);font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.wl-account-card{font-size:16px;font-weight:760;line-height:1.35}
      .wl-account-actions{display:flex;flex-wrap:wrap;gap:10px;padding:16px clamp(20px,3.6vw,42px) clamp(20px,3vw,30px);border-top:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.12)}.wl-account-actions:empty{display:none}.wl-account-btn{min-height:48px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:11px 18px;background:var(--wl-account-gradient,linear-gradient(135deg,#d9ff45,#32b6a8));box-shadow:0 8px 22px rgba(0,0,0,.22),inset 0 1px rgba(255,255,255,.4);color:#112016;font-size:15px;font-weight:900;letter-spacing:.01em;cursor:pointer;touch-action:manipulation;transition:transform .12s ease,filter .12s ease,box-shadow .12s ease}.wl-account-btn:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 11px 28px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.45)}.wl-account-btn:active{transform:scale(.97)}.wl-account-btn:focus-visible{outline:3px solid var(--wl-account-highlight,#d9ff45);outline-offset:3px}.wl-account-btn:disabled{cursor:not-allowed;opacity:.45;filter:saturate(.4);transform:none}.wl-account-btn.secondary{background:rgba(255,255,255,.08);box-shadow:inset 0 1px rgba(255,255,255,.08);color:var(--wl-account-text,#fff)}.wl-account-btn.danger{border-color:rgba(255,174,185,.32);background:linear-gradient(135deg,#ff9c91,#d95b70);color:#2b0a11}
      .wl-account-input{display:block;width:100%;margin:18px 0 2px;padding:16px 17px;border:1px solid rgba(255,255,255,.2);border-radius:15px;outline:0;background:rgba(0,0,0,.22);box-shadow:inset 0 2px 8px rgba(0,0,0,.18);color:#fff;font-size:18px;font-weight:680;transition:border-color .15s ease,box-shadow .15s ease}.wl-account-input:focus{border-color:var(--wl-account-highlight,#d9ff45);box-shadow:0 0 0 3px rgba(217,255,69,.14),inset 0 2px 8px rgba(0,0,0,.18)}
      .wl-account-code{display:inline-block;margin:16px 0;padding:15px 19px;border:1px solid rgba(255,255,255,.2);border-radius:15px;background:rgba(0,0,0,.24);color:#fff;font:800 28px/1.1 monospace;letter-spacing:.14em}
      .wl-account-save{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:center;margin-top:12px;padding:17px 18px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(0,0,0,.13);transition:border-color .14s ease,background .14s ease,transform .14s ease}.wl-account-save:hover{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.07)}.wl-account-save.active{border-color:var(--wl-account-highlight,#d9ff45);background:linear-gradient(120deg,rgba(255,255,255,.12),rgba(0,0,0,.12));box-shadow:0 0 0 1px var(--wl-account-highlight,#d9ff45),0 12px 30px rgba(0,0,0,.18)}.wl-account-save h3{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin-bottom:7px}.wl-account-active-pill{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:var(--wl-account-highlight,#d9ff45);color:#142116;font-size:10px;font-weight:950;letter-spacing:.1em;text-transform:uppercase}.wl-account-save-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.wl-account-save-actions .wl-account-btn{min-height:42px;padding:9px 13px;font-size:13px}
      .wl-account-error,.wl-account-success{position:relative;margin:0;padding:16px 18px 16px 48px;border-radius:16px;font-size:15px;font-weight:680;line-height:1.5}.wl-account-error::before,.wl-account-success::before{position:absolute;left:18px;top:16px;width:20px;height:20px;display:grid;place-items:center;border-radius:50%;font-size:13px;font-weight:950}.wl-account-error{border:1px solid rgba(255,155,170,.42);background:rgba(112,29,45,.48);color:#ffe9ed}.wl-account-error::before{content:"!";background:#ff8d9c;color:#351016}.wl-account-success{border:1px solid rgba(191,255,87,.38);background:rgba(45,105,62,.42);color:#efffe6}.wl-account-success::before{content:"✓";background:var(--wl-account-highlight,#d9ff45);color:#142116}
      @keyframes wl-account-backdrop-in{from{opacity:0}to{opacity:1}}@keyframes wl-account-panel-in{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
      @media(max-width:700px){.wl-account-overlay{padding:10px}.wl-account-panel{width:100%;max-height:96vh;border-radius:22px}.wl-account-header{gap:12px;padding:18px 18px 15px}.wl-account-mark{width:44px;height:44px;border-radius:13px;font-size:25px}.wl-account-trust{display:none}.wl-account-content{padding:18px}.wl-account-status{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.wl-account-card{min-height:92px;padding:14px}.wl-account-save{grid-template-columns:1fr;padding:15px}.wl-account-save-actions{justify-content:stretch}.wl-account-save-actions .wl-account-btn{flex:1}.wl-account-actions{padding:14px 18px 18px}.wl-account-actions>.wl-account-btn{flex:1 1 145px}}
      @media(max-width:430px){.wl-account-status{grid-template-columns:1fr}.wl-account-header{align-items:flex-start}.wl-account-panel h2{font-size:24px}.wl-account-kicker{font-size:9px}.wl-account-identity,.wl-account-profile-switcher{width:100%}.wl-account-profile-select{max-width:none;flex:1}.wl-account-actions>.wl-account-btn{flex-basis:100%}}
      @media(max-height:620px){.wl-account-overlay{padding:8px}.wl-account-panel{max-height:97vh}.wl-account-header{padding-top:14px;padding-bottom:12px}.wl-account-mark{width:40px;height:40px;font-size:23px}.wl-account-content{padding-top:15px;padding-bottom:15px}.wl-account-actions{padding-top:11px;padding-bottom:12px}.wl-account-card{min-height:84px}}
      @media(prefers-reduced-motion:reduce){.wl-account-overlay,.wl-account-panel,.wl-account-btn,.wl-account-save{animation:none!important;transition:none!important}}
    `;
    document.head.appendChild(style);
  }

  function closeOverlay() {
    activeOverlay?.remove();
    activeOverlay = null;
    document.documentElement.classList.remove("wl-account-ui-open");
    clearGameInputState();
  }

  function clearGameInputState() {
    if (globalThis.TouchInput?.clear) globalThis.TouchInput.clear();
    if (globalThis.Input?.clear) globalThis.Input.clear();
  }

  function blockGameInput(overlay) {
    const blockedEvents = [
      "pointerdown", "pointerup", "pointermove", "pointercancel",
      "mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu", "wheel",
      "touchstart", "touchmove", "touchend", "touchcancel",
      "keydown", "keyup", "keypress"
    ];
    for (const type of blockedEvents) {
      overlay.addEventListener(type, event => {
        event.stopPropagation();
        const canScroll = event.target?.closest?.(".wl-account-scroll");
        if (type === "contextmenu" || ((type === "wheel" || type === "touchmove") && !canScroll)) event.preventDefault();
      }, { passive: false });
    }
  }

  function bindReleaseTap(button, action) {
    let touch = null;
    let suppressClickUntil = 0;
    button.addEventListener("touchstart", event => {
      if (button.disabled || event.touches.length !== 1) return;
      const point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, moved: false };
      event.stopPropagation();
      event.preventDefault();
    }, { passive: false });
    button.addEventListener("touchmove", event => {
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 12) touch.moved = true;
      event.stopPropagation();
    }, { passive: true });
    button.addEventListener("touchcancel", event => {
      touch = null;
      event.stopPropagation();
    }, { passive: true });
    button.addEventListener("touchend", event => {
      if (!touch) return;
      const activate = !touch.moved && !button.disabled;
      touch = null;
      suppressClickUntil = Date.now() + 750;
      event.stopPropagation();
      event.preventDefault();
      if (activate) action();
    }, { passive: false });
    button.addEventListener("click", event => {
      if (button.disabled || Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      action();
    });
  }

  function showPanel(title, bodyHtml, actions = []) {
    ensureStyles();
    closeOverlay();
    const overlay = document.createElement("div");
    overlay.className = "wl-account-overlay";
    blockGameInput(overlay);
    clearGameInputState();
    applyAccountTheme(overlay);
    overlay.innerHTML = `<section class="wl-account-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <header class="wl-account-header"><div class="wl-account-mark" aria-hidden="true">W</div><div class="wl-account-heading"><div class="wl-account-kicker">WonderLang Cloud</div><h2>${escapeHtml(title)}</h2></div><div class="wl-account-trust"><span class="wl-account-trust-dot"></span>Secure sync</div></header>
      <div class="wl-account-scroll"><div class="wl-account-content">${bodyHtml}</div></div><div class="wl-account-actions"></div>
    </section>`;
    const actionsHost = overlay.querySelector(".wl-account-actions");
    actions.forEach(action => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `wl-account-btn ${action.kind || ""}`.trim();
      button.textContent = action.label;
      bindReleaseTap(button, () => action.run?.());
      actionsHost.appendChild(button);
    });
    document.documentElement.classList.add("wl-account-ui-open");
    document.body.appendChild(overlay);
    activeOverlay = overlay;
    return overlay;
  }

  function showError(title, error, retry) {
    showPanel(title, `<p class="wl-account-error">${escapeHtml(safeMessage(error))}</p>`, [
      ...(retry ? [{ label: "Try again", run: retry }] : []),
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
  }

  function beginSignIn() {
    try {
      const manager = bridge();
      if (!manager?.openSignIn || manager.openSignIn() !== true) {
        throw new Error("Account sign-in is not available in this build yet.");
      }
      return true;
    } catch (error) {
      showError("Sign-in unavailable", error, beginSignIn);
      return false;
    }
  }

  function showDeviceSignInState(detail) {
    const state = String(detail?.state || "");
    if (state === "starting") {
      showPanel("Sign in to WonderLang", `<p class="wl-account-muted">Opening secure Google sign-in in your browser…</p>`, [
        { label: "Cancel", kind: "secondary", run: () => bridge()?.cancelSignIn?.() }
      ]);
      return;
    }
    if (state === "pending") {
      showPanel("Finish signing in with Google", `
        <p class="wl-account-muted">Choose your Google account in the browser. WonderLang will detect the completed sign-in automatically—there is no code to enter.</p>
        <p class="wl-account-muted">This request expires ${escapeHtml(formatTime(detail.expiresAt))}.</p>`, [
        { label: "Open Google sign-in", run: () => bridge()?.reopenSignIn?.() },
        { label: "Cancel", kind: "secondary", run: () => bridge()?.cancelSignIn?.() },
        { label: "Close", kind: "secondary", run: closeOverlay }
      ]);
      return;
    }
    if (state === "authorized") {
      const signedInOverlay = showPanel("Signed in to WonderLang", `<p class="wl-account-success">Google sign-in succeeded. Refreshing your access and cloud saves…</p>`, [
        { label: "Continue", run: openAccountPanel },
        { label: "Close", kind: "secondary", run: closeOverlay }
      ]);
      setTimeout(() => { if (activeOverlay === signedInOverlay) openAccountPanel(); }, 900);
      return;
    }
    if (state === "error") {
      showError("PC/Mac sign-in failed", new Error(detail.message || "Device sign-in failed."), beginSignIn);
      return;
    }
    if (state === "cancelled") closeOverlay();
  }

  async function openAccountPanel() {
    showPanel("WonderLang account", `<p class="wl-account-muted">Refreshing your secure account and access…</p>`, [
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
    try {
      await refresh();
    } catch (error) {
      if (error?.status === 401 || !bridge()?.getCachedIdToken?.()) {
        showPanel("Sign in to WonderLang", `<p class="wl-account-muted">One easy account links Google, Apple, email, website purchases, mobile access, and cloud saves.</p>`, [
          { label: "Sign in", run: beginSignIn },
          { label: "Close", kind: "secondary", run: closeOverlay }
        ]);
        return;
      }
      showError("Account unavailable", error, openAccountPanel);
      return;
    }

    const access = effectiveCachedEntitlement() || {};
    const accessLabel = access.platformRestricted ? "Owned on another mobile platform" :
      access.accessKind === "subscription" ? "Mobile Monthly" :
      access.accessKind === "premium_lifetime" ? "Premium Lifetime Pass" :
      access.accessKind === "permanent" ? "Polyglot Permanent Access" : access.fullGame ? "Full game" : "Free demo";
    const subscription = current?.subscription?.phase
      ? `${current.subscription.phase}${current.subscription.renewsAt ? ` · renews ${formatTime(current.subscription.renewsAt)}` : current.subscription.endsAt ? ` · ends ${formatTime(current.subscription.endsAt)}` : ""}`
      : access.subscriptionState && access.subscriptionState !== "inactive"
        ? access.subscriptionState
      : "No active subscription";
    const profiles = access.cloudSave ? await listProfiles().catch(() => []) : [];
    if (access.cloudSave && !activeProfileId()) {
      openCloudSavesPanel(true, profiles);
      return;
    }
    const activeProfile = profiles.find(profile => profile.profileId === activeProfileId());
    const profileOptions = profiles.map(profile => `<option value="${escapeHtml(profile.profileId)}" ${profile.profileId === activeProfileId() ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("");
    const profileSwitcher = access.cloudSave && activeProfile ? `<label class="wl-account-profile-switcher"><span class="wl-account-profile-label">Profile</span><select class="wl-account-profile-select" data-profile-switcher aria-label="Active save profile">${profileOptions}</select></label>` : "";
    const overlay = showPanel("WonderLang account", `
      <div class="wl-account-identity-row"><div class="wl-account-identity">${escapeHtml(current?.email || "Signed-in account")}</div>${profileSwitcher}</div>
      <div class="wl-account-status">
        <div class="wl-account-card"><b>Access</b>${escapeHtml(accessLabel)}</div>
        <div class="wl-account-card"><b>Subscription</b>${escapeHtml(subscription)}</div>
        <div class="wl-account-card"><b>Save profile</b>${access.cloudSave ? escapeHtml(activeProfile?.name || "Choose a profile") : "Not included"}</div>
        <div class="wl-account-card"><b>Uploads waiting</b>${retryCount()}</div>
        <div class="wl-account-card"><b>Languages</b>${access.allLanguages ? "All languages" : "Demo access"}</div>
      </div>
      <p class="wl-account-muted">Login methods are linked explicitly. Signing in with Google or Apple alone never grants administrator access.</p>`, [
      { label: "Manage profiles", run: openCloudSavesPanel },
      { label: "Manage login methods", kind: "secondary", run: () => bridge()?.openAccount?.() },
      ...(current?.subscription?.provider ? [{ label: "Manage subscription", kind: "secondary", run: openBillingPortal }] : []),
      { label: "Refresh", kind: "secondary", run: openAccountPanel },
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
    const switcher = overlay.querySelector("[data-profile-switcher]");
    switcher?.addEventListener("change", () => {
      const profile = profiles.find(item => item.profileId === switcher.value);
      if (!profile || profile.profileId === activeProfileId()) return;
      selectProfile(profile, { profiles, onCancel: openAccountPanel });
    });
  }

  async function openBillingPortal() {
    try {
      const provider = authoritativeAccount()?.subscription?.provider;
      if (provider === "google_play") {
        const url = "https://play.google.com/store/account/subscriptions?sku=wonderlangmonthly&package=com.wonderlang.app";
        if (bridge()?.openExternalUrl?.(url) === false) throw new Error("Could not open Google Play subscriptions.");
        return;
      }
      if (provider === "apple") {
        const url = "https://apps.apple.com/account/subscriptions";
        if (bridge()?.openExternalUrl?.(url) === false) throw new Error("Could not open Apple subscriptions.");
        return;
      }
      if (provider !== "stripe") throw new Error("This subscription does not have a supported management provider.");
      const { url } = await request("/api/v1/billing-portal", { method: "POST" });
      if (!url || bridge()?.openExternalUrl?.(url) === false) throw new Error("Could not open the secure billing portal.");
    } catch (error) {
      showError("Billing portal unavailable", error, openAccountPanel);
    }
  }

  async function ensureProfileSelection() {
    if (profileSelectionInFlight || !current?.uid || !effectiveCachedEntitlement()?.cloudSave || activeProfileId()) return;
    profileSelectionInFlight = true;
    try { await openCloudSavesPanel(true); }
    finally { profileSelectionInFlight = false; }
  }

  async function openCloudSavesPanel(forcePick = false, suppliedProfiles = null) {
    showPanel("Save profiles", `<p class="wl-account-muted">Loading your complete cloud-save profiles…</p>`, [
      ...(!forcePick || activeProfileId() ? [{ label: "Close", kind: "secondary", run: closeOverlay }] : [])
    ]);
    try {
      const profiles = suppliedProfiles || await listProfiles();
      const active = activeProfileId();
      const intro = forcePick && !active
        ? `<p class="wl-account-success">Choose which profile this device will use. Your current local saves can become that profile's starting saves.</p>`
        : `<p class="wl-account-muted">All saves and global.rmmzsave synchronize automatically inside the selected profile. Up to six people or learning paths can share one WonderLang account without mixing progress.</p>`;
      const rows = profiles.map(profile => `<div class="wl-account-save ${profile.profileId === active ? "active" : ""}">
        <div><h3>${escapeHtml(profile.name)}${profile.profileId === active ? `<span class="wl-account-active-pill">Active</span>` : ""}</h3><div class="wl-account-muted">${profile.currentRevision ? `Cloud updated ${escapeHtml(formatTime(profile.updatedAt))}` : "No cloud saves yet"}</div></div>
        <div class="wl-account-save-actions"><button class="wl-account-btn" data-select-profile="${escapeHtml(profile.profileId)}" ${profile.profileId === active ? "disabled" : ""}>${profile.profileId === active ? "Selected" : "Use profile"}</button><button class="wl-account-btn secondary" data-rename-profile="${escapeHtml(profile.profileId)}">Rename</button></div>
      </div>`).join("");
      const overlay = showPanel("Save profiles", intro + rows, [
        ...(profiles.length < 6 ? [{ label: "Create profile", run: showCreateProfile }] : []),
        { label: "Refresh", kind: "secondary", run: openCloudSavesPanel },
        ...(!forcePick || active ? [{ label: "Back to account", kind: "secondary", run: openAccountPanel }] : []),
        ...(!forcePick || active ? [{ label: "Close", kind: "secondary", run: closeOverlay }] : [])
      ]);
      overlay.querySelectorAll("[data-select-profile]").forEach(button => bindReleaseTap(button, () => selectProfile(profiles.find(profile => profile.profileId === button.dataset.selectProfile), { profiles, onCancel: openCloudSavesPanel })));
      overlay.querySelectorAll("[data-rename-profile]").forEach(button => bindReleaseTap(button, () => showRenameProfile(profiles.find(profile => profile.profileId === button.dataset.renameProfile))));
    } catch (error) {
      showError("Save profiles unavailable", error, openCloudSavesPanel);
    }
  }

  function profileNameEditor(title, initialName, submitLabel, onSubmit) {
    const overlay = showPanel(title, `<p class="wl-account-muted">Use a name such as Jonathan, Emma, Japanese, or Spanish.</p><input class="wl-account-input" maxlength="40" value="${escapeHtml(initialName || "")}" aria-label="Profile name">`, [
      { label: submitLabel, run: async () => {
        const input = overlay.querySelector(".wl-account-input");
        const name = String(input?.value || "").trim();
        if (!name) { input?.focus(); return; }
        await onSubmit(name);
      } },
      { label: "Cancel", kind: "secondary", run: openCloudSavesPanel }
    ]);
    setTimeout(() => overlay.querySelector(".wl-account-input")?.focus(), 0);
  }

  function showCreateProfile() {
    profileNameEditor("Create save profile", "", "Create", async name => {
      try {
        showPanel("Creating profile", `<p class="wl-account-muted">Creating ${escapeHtml(name)}…</p>`);
        const profile = await request("/api/v1/cloud-save-profiles", { method: "POST", body: { name } });
        await selectProfile(profile);
      } catch (error) { showError("Profile was not created", error, showCreateProfile); }
    });
  }

  function showRenameProfile(profile) {
    if (!profile) return openCloudSavesPanel();
    profileNameEditor("Rename save profile", profile.name, "Rename", async name => {
      try {
        await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profile.profileId)}/rename`, { method: "POST", body: { name } });
        await openCloudSavesPanel();
      } catch (error) { showError("Profile was not renamed", error, () => showRenameProfile(profile)); }
    });
  }

  async function clearWorkspaceForProfile(profileId) {
    const globalJson = await StorageManager.objectToJson([]);
    await applyProfileBundle({ magic: "WL_CLOUD_PROFILE", version: 1, profileId, files: { global: globalJson } }, profileId);
  }

  async function activateProfile(profile, source) {
    if (!profile) return;
    try {
      showPanel("Switching save profile", `<p class="wl-account-muted">Preparing ${escapeHtml(profile.name)} without mixing save files…</p>`);
      if (source === "cloud") {
        await restoreProfile(profile.profileId);
        setActiveProfileId(profile.profileId);
      } else {
        if (source === "empty") await clearWorkspaceForProfile(profile.profileId);
        setActiveProfileId(profile.profileId);
      }
      if (source === "device" || source === "empty") {
        const result = await uploadProfile(profile.profileId, { baseRevision: profile.currentRevision || null, showConflict: true });
        if (result?.conflict) return;
      }
      showPanel("Profile ready", `<p class="wl-account-success">${escapeHtml(profile.name)} is active. global.rmmzsave and every save slot will now synchronize automatically.</p>`, [
        { label: "Continue", run: () => {
          closeOverlay();
          if (typeof Scene_Map !== "undefined" && SceneManager._scene instanceof Scene_Map) SceneManager.goto(Scene_Title);
        } },
        { label: "Account", kind: "secondary", run: openAccountPanel }
      ]);
    } catch (error) { showError("Could not switch profile", error, () => selectProfile(profile)); }
  }

  async function switchFromActiveProfile(profile) {
    try {
      showPanel("Saving current profile", `<p class="wl-account-muted">Uploading and finalizing every save in the current profile before switching…</p>`);
      const result = await syncActiveProfileNow();
      if (result?.conflict) return;
      return activateProfile(profile, profile.currentRevision ? "cloud" : "empty");
    } catch (error) {
      showError("Profile switch paused", new Error(`WonderLang could not safely upload the current profile. Nothing was switched or downloaded. Connect to the internet and try again. ${safeMessage(error)}`), () => switchFromActiveProfile(profile));
    }
  }

  async function selectProfile(profile, options = {}) {
    const onCancel = typeof options.onCancel === "function" ? options.onCancel : openCloudSavesPanel;
    if (!profile || profile.profileId === activeProfileId()) return onCancel();
    const previous = activeProfileId();
    if (previous) {
      const currentProfile = Array.isArray(options.profiles) ? options.profiles.find(item => item.profileId === previous) : null;
      const currentName = currentProfile?.name || "the current profile";
      showPanel(`Switch to ${profile.name}?`, `<p class="wl-account-muted">WonderLang will first upload and finalize <strong>${escapeHtml(currentName)}</strong>, including global.rmmzsave and every save slot. Only after that succeeds will it download and activate <strong>${escapeHtml(profile.name)}</strong>. If the upload fails, this device stays on ${escapeHtml(currentName)}.</p>`, [
        { label: "Sync and switch", run: () => switchFromActiveProfile(profile) },
        { label: "Cancel", kind: "secondary", run: onCancel }
      ]);
      return;
    }
    if (hasLocalPlayerSaves() && profile.currentRevision) {
      showPanel(`Use ${profile.name} on this device?`, `<p class="wl-account-muted">This device already has WonderLang saves, and this profile also has cloud saves. Choose which complete set should become this profile. No individual slots will be mixed.</p>`, [
        { label: "Keep device saves", run: () => activateProfile(profile, "device") },
        { label: "Use cloud saves", kind: "danger", run: () => activateProfile(profile, "cloud") },
        { label: "Cancel", kind: "secondary", run: openCloudSavesPanel }
      ]);
      return;
    }
    return activateProfile(profile, hasLocalPlayerSaves() ? "device" : profile.currentRevision ? "cloud" : "empty");
  }

  async function presentProfileConflict(profileId) {
    let remote;
    try { remote = await request(`/api/v1/cloud-save-profiles/${encodeURIComponent(profileId)}/download`); }
    catch (error) { showError("Cloud-profile conflict", error, () => presentProfileConflict(profileId)); return; }
    showPanel("This profile changed on two devices", `<p class="wl-account-muted">WonderLang did not mix or overwrite the save sets. Choose which complete profile should become current.</p><div class="wl-account-status"><div class="wl-account-card"><b>This device</b>global.rmmzsave + all local saves</div><div class="wl-account-card"><b>Cloud</b>${escapeHtml(formatTime(remote.manifest.updatedAt))}</div></div>`, [
      { label: "Keep this device", run: async () => {
        try { await uploadProfile(profileId, { baseRevision: remote.manifest.currentRevision, showConflict: true }); closeOverlay(); }
        catch (error) { showError("Device profile was not uploaded", error, () => presentProfileConflict(profileId)); }
      } },
      { label: "Use cloud profile", kind: "danger", run: async () => {
        try { await restoreProfile(profileId); closeOverlay(); }
        catch (error) { showError("Cloud profile was not restored", error, () => presentProfileConflict(profileId)); }
      } },
      { label: "Not now", kind: "secondary", run: closeOverlay }
    ]);
    window.dispatchEvent(new CustomEvent("wl-cloud-profile-conflict", { detail: { profileId, remote: remote.manifest } }));
  }

  const originalSaveObject = StorageManager.saveObject;
  StorageManager.saveObject = function(saveName, object) {
    return originalSaveObject.call(this, saveName, object).then(result => {
      if (!applyingProfile && /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/.test(String(saveName || ""))) scheduleProfileSync();
      return result;
    });
  };
  const originalRemoveSave = StorageManager.remove;
  StorageManager.remove = function(saveName) {
    const result = originalRemoveSave.call(this, saveName);
    if (!applyingProfile && /^(?:global|file(?:0|[1-9]|1[0-9]|20))$/.test(String(saveName || ""))) scheduleProfileSync();
    return result;
  };

  window.WLAccountEntitlements = {
    refresh,
    account,
    current: entitlement,
    currentOfflineSafe: effectiveCachedEntitlement,
    isProductPurchased: ownsProduct,
    listProfiles,
    uploadActiveProfile: syncActiveProfileNow,
    restoreProfile,
    activeProfileId,
    openAccount: openAccountPanel,
    openCloudSaves: openCloudSavesPanel,
    openSignIn: beginSignIn,
    _nativeToken(token) {
      const waiters = tokenWaiters;
      tokenWaiters = [];
      waiters.forEach(resolve => resolve(String(token || "")));
      if (token) refresh().catch(error => console.warn("[WonderLang Account] Entitlement refresh failed.", error));
    },
    _nativeAccount(payload) {
      try {
        const value = typeof payload === "string" ? JSON.parse(payload) : payload;
        if (!value || typeof value !== "object") throw new Error("Invalid account snapshot.");
        cache(value);
        window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: value.entitlements || null }));
        drainUploadQueue().catch(error => console.warn("[WonderLang Cloud Save] Retry queue paused.", safeMessage(error)));
        ensureProfileSelection().catch(error => console.warn("[WonderLang Cloud Save] Profile selection paused.", safeMessage(error)));
      } catch (error) {
        console.warn("[WonderLang Account] Native account snapshot was invalid.", error);
      }
    },
    _nativePurchaseVerified(payload) {
      try {
        const result = typeof payload === "string" ? JSON.parse(payload) : payload;
        if (!result?.entitlements) throw new Error("The verified purchase response was incomplete.");
        cache(current?.uid ? { ...current, entitlements: result.entitlements } : { entitlements: result.entitlements });
        window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: result.entitlements }));
        window.dispatchEvent(new CustomEvent("wl-purchase-verification-complete", { detail: { ok: true } }));
        refresh().catch(error => console.warn("[WonderLang Account] Post-purchase refresh failed.", error));
      } catch (error) {
        this._nativePurchaseFailed(safeMessage(error, "The verified purchase response was invalid."));
      }
    },
    _nativePurchaseFailed(message) {
      const text = String(message || "Purchase verification failed.").slice(0, 300);
      console.warn("[WonderLang Account] Purchase verification failed.", text);
      window.dispatchEvent(new CustomEvent("wl-purchase-verification-complete", { detail: { ok: false, message: text } }));
    },
    _nativeSignedOut() {
      cache(null);
      window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: null }));
    }
  };

  window.addEventListener("wl-device-sign-in-state", event => showDeviceSignInState(event.detail));

  window.addEventListener("online", () => drainUploadQueue().catch(error => console.warn("[WonderLang Cloud Save] Retry queue paused.", safeMessage(error))));
  setTimeout(() => drainUploadQueue().catch(() => undefined), 5_000);

  PluginManager.registerCommand(pluginName, "openAccount", openAccountPanel);
  PluginManager.registerCommand(pluginName, "openCloudSaves", openCloudSavesPanel);
  PluginManager.registerCommand(pluginName, "refreshEntitlements", () => refresh().catch(error => showError("Account refresh failed", error, openAccountPanel)));

  if (openOnPlaytest && typeof Utils !== "undefined" && Utils.isOptionValid?.("test")) {
    let openedForPlaytest = false;
    const originalOnSceneStart = SceneManager.onSceneStart;
    SceneManager.onSceneStart = function() {
      const result = originalOnSceneStart.apply(this, arguments);
      const scene = this._scene;
      const readyScene = (typeof Scene_Title !== "undefined" && scene instanceof Scene_Title)
        || (typeof Scene_Map !== "undefined" && scene instanceof Scene_Map);
      if (!openedForPlaytest && readyScene) {
        openedForPlaytest = true;
        setTimeout(() => openAccountPanel(), 250);
      }
      return result;
    };
  }
})();
