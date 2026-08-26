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
 *   getCachedIdToken(), refreshIdToken(), openSignIn(), openAccount(),
 *   openExternalUrl(url), and Firebase-auth callbacks documented below.
 *
 * Every selected profile contains global.rmmzsave and every file0-file20 save.
 * Local saves finish first, then the complete profile synchronizes automatically.
 * A revision conflict never overwrites either side without asking the player.
 * Verified permanent and Premium Lifetime access remains available offline on its granted platform. A cached subscription remains usable
 * through its paid period or for seven days after the last server refresh, whichever is later;
 * provider grace access ends at the server-provided grace deadline.
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
  function accountUid() { return String(current?.uid || "signed-out"); }
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
  function entitlement() { return current?.entitlements || null; }
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
  function account() { return current; }
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
    const send = token => fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body ? { body } : {})
    });
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

  function ensureStyles() {
    if (document.getElementById("wl-account-styles")) return;
    const style = document.createElement("style");
    style.id = "wl-account-styles";
    style.textContent = `
      .wl-account-overlay{position:fixed;inset:0;z-index:999999;background:rgba(4,9,18,.88);display:flex;align-items:center;justify-content:center;padding:4vh 4vw;box-sizing:border-box;color:#f6f8ff;font-family:Arial,sans-serif}
      .wl-account-panel{width:min(900px,92vw);max-height:88vh;overflow:auto;background:#101827;border:1px solid #31405c;border-radius:18px;box-shadow:0 30px 90px #000;padding:28px;box-sizing:border-box}
      .wl-account-panel h2{font-size:30px;margin:0 0 8px}.wl-account-panel h3{font-size:21px;margin:24px 0 8px}.wl-account-muted{color:#aab6cb;line-height:1.5}.wl-account-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:20px 0}.wl-account-card{background:#172238;border:1px solid #2b3b59;border-radius:12px;padding:16px}.wl-account-card b{display:block;color:#8fd5ff;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}.wl-account-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}.wl-account-btn{min-height:48px;border:0;border-radius:11px;padding:12px 18px;background:#2c78ff;color:white;font-size:17px;font-weight:700;cursor:pointer;touch-action:manipulation}.wl-account-btn:disabled{cursor:not-allowed;opacity:.5}.wl-account-btn.secondary{background:#263550}.wl-account-btn.danger{background:#9d3947}.wl-account-input{display:block;width:100%;box-sizing:border-box;margin:16px 0;padding:14px 16px;border-radius:10px;border:1px solid #536b93;background:#091221;color:#fff;font-size:18px}.wl-account-code{display:inline-block;margin:12px 0;padding:14px 18px;border:1px solid #536b93;border-radius:12px;background:#0a1220;color:#fff;font:700 30px/1.1 monospace;letter-spacing:.12em}.wl-account-save{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;border-top:1px solid #2b3b59;padding:16px 0}.wl-account-save.active{background:#14283a;margin:0 -12px;padding:16px 12px;border-radius:10px}.wl-account-save-actions{display:flex;flex-wrap:wrap;gap:9px}.wl-account-error{background:#4a1f2a;border:1px solid #9d3947;padding:14px;border-radius:10px;color:#ffdce2}.wl-account-success{background:#173f32;border:1px solid #27795b;padding:14px;border-radius:10px;color:#d8ffed}@media(max-width:650px){.wl-account-panel{padding:20px}.wl-account-save{grid-template-columns:1fr}.wl-account-btn{width:100%}}
    `;
    document.head.appendChild(style);
  }

  function closeOverlay() {
    activeOverlay?.remove();
    activeOverlay = null;
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
    overlay.innerHTML = `<section class="wl-account-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><h2>${escapeHtml(title)}</h2>${bodyHtml}<div class="wl-account-actions"></div></section>`;
    const actionsHost = overlay.querySelector(".wl-account-actions");
    actions.forEach(action => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `wl-account-btn ${action.kind || ""}`.trim();
      button.textContent = action.label;
      bindReleaseTap(button, () => action.run?.());
      actionsHost.appendChild(button);
    });
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
    showPanel("WonderLang account", `
      <p class="wl-account-muted">${escapeHtml(current?.email || "Signed-in account")}</p>
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
      ...(access.accessKind === "subscription" ? [{ label: "Manage subscription", kind: "secondary", run: openBillingPortal }] : []),
      { label: "Refresh", kind: "secondary", run: openAccountPanel },
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
  }

  async function openBillingPortal() {
    try {
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
        <div><h3>${escapeHtml(profile.name)}${profile.profileId === active ? " · Active" : ""}</h3><div class="wl-account-muted">${profile.currentRevision ? `Cloud updated ${escapeHtml(formatTime(profile.updatedAt))}` : "No cloud saves yet"}</div></div>
        <div class="wl-account-save-actions"><button class="wl-account-btn" data-select-profile="${escapeHtml(profile.profileId)}" ${profile.profileId === active ? "disabled" : ""}>${profile.profileId === active ? "Selected" : "Use profile"}</button><button class="wl-account-btn secondary" data-rename-profile="${escapeHtml(profile.profileId)}">Rename</button></div>
      </div>`).join("");
      const overlay = showPanel("Save profiles", intro + rows, [
        ...(profiles.length < 6 ? [{ label: "Create profile", run: showCreateProfile }] : []),
        { label: "Refresh", kind: "secondary", run: openCloudSavesPanel },
        ...(!forcePick || active ? [{ label: "Back to account", kind: "secondary", run: openAccountPanel }] : []),
        ...(!forcePick || active ? [{ label: "Close", kind: "secondary", run: closeOverlay }] : [])
      ]);
      overlay.querySelectorAll("[data-select-profile]").forEach(button => bindReleaseTap(button, () => selectProfile(profiles.find(profile => profile.profileId === button.dataset.selectProfile))));
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

  async function selectProfile(profile) {
    if (!profile || profile.profileId === activeProfileId()) return openCloudSavesPanel();
    const previous = activeProfileId();
    if (previous) {
      try {
        showPanel("Saving current profile", `<p class="wl-account-muted">Finishing the current profile sync before switching…</p>`);
        const result = await syncActiveProfileNow();
        if (result?.conflict) return;
      } catch (error) {
        showError("Profile switch paused", new Error(`WonderLang could not safely upload the current profile. Connect to the internet and try again. ${safeMessage(error)}`), () => selectProfile(profile));
        return;
      }
      return activateProfile(profile, profile.currentRevision ? "cloud" : "empty");
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
      if (/^(?:global|file(?:0|[1-9]|1[0-9]|20))$/.test(String(saveName || ""))) scheduleProfileSync();
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
