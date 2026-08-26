/*:
 * @target MZ
 * @plugindesc WonderLang account UI, cross-platform entitlements, and conflict-safe cloud saves (test integration).
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
 * @text Open Cloud Saves
 * @desc Lists cloud slots and lets the player explicitly keep the device copy or use the cloud copy.
 *
 * @command refreshEntitlements
 * @text Refresh Entitlements
 * @desc Refreshes the signed-in player's server-authoritative access snapshot.
 *
 * @command uploadSave
 * @text Upload Save to Cloud
 * @arg savefileId
 * @text Save Slot
 * @type number
 * @min 1
 * @default 1
 *
 * @help
 * Duplicate/test-build integration. Keep production WonderLang files untouched until
 * this copy has passed the Android release gate and real-device testing.
 *
 * Native bridge name: WLAccountManager
 *   getCachedIdToken(), refreshIdToken(), openSignIn(), openAccount(),
 *   openExternalUrl(url), and Firebase-auth callbacks documented below.
 *
 * Local saves always finish first. Cloud access never deletes data when an entitlement
 * lapses. A revision conflict never overwrites either side automatically: the player sees
 * timestamps and chooses Keep device, Use cloud, or Not now.
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
  function retryQueue() { return loadJson(retryKey(), {}); }
  function retryCount() { return Object.keys(retryQueue()).length; }
  function saveRetryQueue(queue) {
    if (Object.keys(queue).length) localStorage.setItem(retryKey(), JSON.stringify(queue));
    else localStorage.removeItem(retryKey());
    window.dispatchEvent(new CustomEvent("wl-cloud-save-retry-state", { detail: { queued: Object.keys(queue).length } }));
  }
  function queueUpload(savefileId, error) {
    const queue = retryQueue();
    const slot = `save${Number(savefileId)}`;
    const previous = queue[slot] || {};
    const attemptCount = Number(previous.attemptCount || 0) + 1;
    const delayMs = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.min(attemptCount - 1, 9)));
    queue[slot] = {
      savefileId: Number(savefileId),
      queuedAt: previous.queuedAt || new Date().toISOString(),
      attemptCount,
      notBefore: new Date(Date.now() + delayMs).toISOString(),
      lastError: safeMessage(error)
    };
    saveRetryQueue(queue);
  }
  function clearQueuedUpload(savefileId) {
    const queue = retryQueue();
    delete queue[`save${Number(savefileId)}`];
    saveRetryQueue(queue);
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
      for (const item of Object.values(queue).sort((a, b) => Number(a.savefileId) - Number(b.savefileId))) {
        if (Date.parse(item.notBefore || "") > Date.now()) continue;
        try {
          const result = await uploadSlot(item.savefileId);
          if (!result?.conflict) clearQueuedUpload(item.savefileId);
          else clearQueuedUpload(item.savefileId);
        } catch (error) {
          queueUpload(item.savefileId, error);
        }
      }
    } finally {
      drainingRetries = false;
    }
  }

  async function saveBytes(savefileId) {
    const object = await StorageManager.loadObject(DataManager.makeSavename(savefileId));
    return textEncoder.encode(JSON.stringify(object));
  }

  async function uploadSlot(savefileId, options = {}) {
    const value = effectiveCachedEntitlement();
    if (!value?.cloudSave) return { skipped: "not_entitled" };
    const slot = `save${Number(savefileId)}`;
    const bytes = await saveBytes(savefileId);
    const baseRevision = Object.prototype.hasOwnProperty.call(options, "baseRevision")
      ? options.baseRevision
      : (revisions()[slot] || null);
    const prepare = await request("/api/v1/cloud-saves/prepare-upload", {
      method: "POST",
      body: {
        slot,
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
    if (!upload.ok) throw new Error(`Cloud upload failed (${upload.status}).`);
    try {
      const manifest = await request("/api/v1/cloud-saves/finalize", {
        method: "POST",
        body: { uploadId: prepare.uploadId }
      });
      setRevision(slot, manifest.currentRevision);
      clearQueuedUpload(savefileId);
      window.dispatchEvent(new CustomEvent("wl-cloud-save-synced", { detail: { savefileId, manifest } }));
      return manifest;
    } catch (error) {
      if (error?.status === 409 && options.showConflict !== false) {
        await presentConflict(savefileId);
        return { conflict: true };
      }
      throw error;
    }
  }

  async function downloadSlot(savefileId) {
    const slot = `save${Number(savefileId)}`;
    const remote = await request(`/api/v1/cloud-saves/${slot}`);
    const response = await fetch(remote.downloadUrl);
    if (!response.ok) throw new Error(`Cloud download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== remote.manifest.byteLength || await sha256Hex(bytes) !== remote.manifest.sha256) {
      throw new Error("Downloaded cloud save failed its integrity check.");
    }
    return { remote, object: JSON.parse(textDecoder.decode(bytes)) };
  }

  async function restoreSlot(savefileId) {
    const { remote, object } = await downloadSlot(savefileId);
    await StorageManager.saveObject(DataManager.makeSavename(savefileId), object);
    setRevision(`save${Number(savefileId)}`, remote.manifest.currentRevision);
    window.dispatchEvent(new CustomEvent("wl-cloud-save-restored", { detail: { savefileId, manifest: remote.manifest } }));
    return remote.manifest;
  }

  async function listCloudSaves() {
    return (await request("/api/v1/cloud-saves")).saves || [];
  }

  function localSaveInfo(savefileId) {
    const info = typeof DataManager.savefileInfo === "function" ? DataManager.savefileInfo(Number(savefileId)) : null;
    return {
      exists: Boolean(info),
      timestamp: info?.timestamp ? new Date(info.timestamp).toISOString() : null,
      title: info?.title || "Device save"
    };
  }

  function localSaveIds() {
    const maximum = Math.max(1, Number(DataManager.maxSavefiles?.()) || 20);
    const ids = [];
    for (let id = 1; id <= maximum; id += 1) {
      if (localSaveInfo(id).exists) ids.push(id);
    }
    return ids;
  }

  function ensureStyles() {
    if (document.getElementById("wl-account-styles")) return;
    const style = document.createElement("style");
    style.id = "wl-account-styles";
    style.textContent = `
      .wl-account-overlay{position:fixed;inset:0;z-index:999999;background:rgba(4,9,18,.88);display:flex;align-items:center;justify-content:center;padding:4vh 4vw;box-sizing:border-box;color:#f6f8ff;font-family:Arial,sans-serif}
      .wl-account-panel{width:min(900px,92vw);max-height:88vh;overflow:auto;background:#101827;border:1px solid #31405c;border-radius:18px;box-shadow:0 30px 90px #000;padding:28px;box-sizing:border-box}
      .wl-account-panel h2{font-size:30px;margin:0 0 8px}.wl-account-panel h3{font-size:21px;margin:24px 0 8px}.wl-account-muted{color:#aab6cb;line-height:1.5}.wl-account-status{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:20px 0}.wl-account-card{background:#172238;border:1px solid #2b3b59;border-radius:12px;padding:16px}.wl-account-card b{display:block;color:#8fd5ff;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}.wl-account-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:22px}.wl-account-btn{min-height:48px;border:0;border-radius:11px;padding:12px 18px;background:#2c78ff;color:white;font-size:17px;font-weight:700;cursor:pointer;touch-action:manipulation}.wl-account-btn:disabled{cursor:not-allowed;opacity:.5}.wl-account-btn.secondary{background:#263550}.wl-account-btn.danger{background:#9d3947}.wl-account-code{display:inline-block;margin:12px 0;padding:14px 18px;border:1px solid #536b93;border-radius:12px;background:#0a1220;color:#fff;font:700 30px/1.1 monospace;letter-spacing:.12em}.wl-account-save{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;border-top:1px solid #2b3b59;padding:16px 0}.wl-account-save-actions{display:flex;flex-wrap:wrap;gap:9px}.wl-account-error{background:#4a1f2a;border:1px solid #9d3947;padding:14px;border-radius:10px;color:#ffdce2}.wl-account-success{background:#173f32;border:1px solid #27795b;padding:14px;border-radius:10px;color:#d8ffed}@media(max-width:650px){.wl-account-panel{padding:20px}.wl-account-save{grid-template-columns:1fr}.wl-account-btn{width:100%}}
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
    showPanel("WonderLang account", `
      <p class="wl-account-muted">${escapeHtml(current?.email || "Signed-in account")}</p>
      <div class="wl-account-status">
        <div class="wl-account-card"><b>Access</b>${escapeHtml(accessLabel)}</div>
        <div class="wl-account-card"><b>Subscription</b>${escapeHtml(subscription)}</div>
        <div class="wl-account-card"><b>Cloud saves</b>${access.cloudSave ? "Enabled" : "Not included"}</div>
        <div class="wl-account-card"><b>Uploads waiting</b>${retryCount()}</div>
        <div class="wl-account-card"><b>Languages</b>${access.allLanguages ? "All languages" : "Demo access"}</div>
      </div>
      <p class="wl-account-muted">Login methods are linked explicitly. Signing in with Google or Apple alone never grants administrator access.</p>`, [
      { label: "Sync saves", run: openCloudSavesPanel },
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

  async function openCloudSavesPanel() {
    showPanel("Cloud saves", `<p class="wl-account-muted">Loading your cloud-save index…</p>`, [
      { label: "Close", kind: "secondary", run: closeOverlay }
    ]);
    try {
      const saves = await listCloudSaves();
      const remoteById = new Map(saves.map(save => [Number(String(save.slot).replace(/^save/, "")), save]));
      const ids = [...new Set([...remoteById.keys(), ...localSaveIds()])].filter(Number.isFinite).sort((a, b) => a - b);
      const rows = ids.length ? ids.map(id => {
        const save = remoteById.get(id);
        const local = localSaveInfo(id);
        const cloudLine = save ? escapeHtml(formatTime(save.updatedAt)) : "Not uploaded";
        const revisionLine = save ? `<br>Revision: ${escapeHtml(String(save.currentRevision).slice(0, 8))}` : "";
        const actions = save
          ? `<button class="wl-account-btn" data-use-cloud="${id}">Use cloud</button><button class="wl-account-btn secondary" data-keep-device="${id}" ${local.exists ? "" : "disabled"}>Upload device copy</button>`
          : `<button class="wl-account-btn" data-upload-local="${id}" ${local.exists ? "" : "disabled"}>Upload to cloud</button>`;
        return `<div class="wl-account-save" data-slot="${id}"><div><h3>Save ${id}</h3><div class="wl-account-muted">Cloud: ${cloudLine}<br>Device: ${escapeHtml(formatTime(local.timestamp))}${revisionLine}</div></div><div class="wl-account-save-actions">${actions}</div></div>`;
      }).join("") : `<p class="wl-account-muted">No device or cloud saves exist yet. Create a normal WonderLang save, then return here to upload it.</p>`;
      const overlay = showPanel("Cloud saves", rows, [
        { label: "Refresh", kind: "secondary", run: openCloudSavesPanel },
        { label: "Back to account", kind: "secondary", run: openAccountPanel },
        { label: "Close", kind: "secondary", run: closeOverlay }
      ]);
      overlay.querySelectorAll("[data-use-cloud]").forEach(button => bindReleaseTap(button, () => confirmUseCloud(Number(button.dataset.useCloud))));
      overlay.querySelectorAll("[data-keep-device]").forEach(button => bindReleaseTap(button, () => keepDeviceCopy(Number(button.dataset.keepDevice))));
      overlay.querySelectorAll("[data-upload-local]").forEach(button => bindReleaseTap(button, () => uploadLocalCopy(Number(button.dataset.uploadLocal))));
    } catch (error) {
      showError("Cloud saves unavailable", error, openCloudSavesPanel);
    }
  }

  async function uploadLocalCopy(savefileId) {
    if (!effectiveCachedEntitlement()?.cloudSave) {
      showError("Cloud save is not included", new Error("Cloud saves require Mobile Monthly or Premium Lifetime access."), openAccountPanel);
      return;
    }
    try {
      showPanel("Uploading save", `<p class="wl-account-muted">Uploading device save ${Number(savefileId)} to the WonderLang cloud…</p>`);
      const result = await uploadSlot(savefileId, { baseRevision: null, showConflict: true });
      if (result?.conflict) return;
      showPanel("Save uploaded", `<p class="wl-account-success">Save ${Number(savefileId)} is now stored in the WonderLang cloud.</p>`, [
        { label: "Done", run: openCloudSavesPanel }
      ]);
    } catch (error) {
      showError("Save was not uploaded", error, () => uploadLocalCopy(savefileId));
    }
  }

  async function presentConflict(savefileId) {
    let remote;
    try { remote = await request(`/api/v1/cloud-saves/save${Number(savefileId)}`); }
    catch (error) { showError("Cloud-save conflict", error, () => presentConflict(savefileId)); return; }
    const local = localSaveInfo(savefileId);
    showPanel(`Save ${savefileId} changed on two devices`, `
      <p class="wl-account-muted">WonderLang did not overwrite either copy. Choose which one should become current.</p>
      <div class="wl-account-status">
        <div class="wl-account-card"><b>Device copy</b>${escapeHtml(formatTime(local.timestamp))}</div>
        <div class="wl-account-card"><b>Cloud copy</b>${escapeHtml(formatTime(remote.manifest.updatedAt))}</div>
      </div>`, [
      { label: "Keep device", run: () => keepDeviceCopy(savefileId, remote.manifest.currentRevision) },
      { label: "Use cloud", kind: "danger", run: () => confirmUseCloud(savefileId) },
      { label: "Not now", kind: "secondary", run: closeOverlay }
    ]);
    window.dispatchEvent(new CustomEvent("wl-cloud-save-conflict", { detail: { savefileId, local, remote: remote.manifest } }));
  }

  async function keepDeviceCopy(savefileId, knownRemoteRevision) {
    try {
      const remoteRevision = knownRemoteRevision || (await request(`/api/v1/cloud-saves/save${Number(savefileId)}`)).manifest.currentRevision;
      showPanel("Uploading device copy", `<p class="wl-account-muted">WonderLang first synchronized the latest cloud revision. Uploading without deleting the previous cloud version…</p>`);
      const result = await uploadSlot(savefileId, { baseRevision: remoteRevision, showConflict: true });
      if (result?.conflict) return;
      showPanel("Cloud save updated", `<p class="wl-account-success">The device copy is now current. The service retained recent cloud revisions for recovery.</p>`, [
        { label: "Done", run: openCloudSavesPanel }
      ]);
    } catch (error) {
      showError("Device copy was not uploaded", error, () => keepDeviceCopy(savefileId));
    }
  }

  function confirmUseCloud(savefileId) {
    const local = localSaveInfo(savefileId);
    showPanel(`Use cloud save ${savefileId}?`, `<p class="wl-account-muted">Cloud will replace this device slot only after download and SHA-256 integrity verification.<br><br>Device copy: ${escapeHtml(formatTime(local.timestamp))}</p>`, [
      { label: "Use cloud", kind: "danger", run: async () => {
        try {
          showPanel("Restoring cloud save", `<p class="wl-account-muted">Downloading and verifying before writing the device slot…</p>`);
          await restoreSlot(savefileId);
          showPanel("Cloud save restored", `<p class="wl-account-success">Save ${savefileId} now uses the verified cloud copy.</p>`, [
            { label: "Done", run: openCloudSavesPanel }
          ]);
        } catch (error) {
          showError("Cloud save was not restored", error, () => confirmUseCloud(savefileId));
        }
      } },
      { label: "Not now", kind: "secondary", run: openCloudSavesPanel }
    ]);
  }

  const originalSaveGame = DataManager.saveGame;
  DataManager.saveGame = async function(savefileId) {
    const saved = await originalSaveGame.call(this, savefileId);
    if (saved) uploadSlot(savefileId).catch(error => {
      console.warn("[WonderLang Cloud Save] Local save succeeded; cloud upload did not.", error);
      queueUpload(savefileId, error);
      window.dispatchEvent(new CustomEvent("wl-cloud-save-error", { detail: { savefileId, message: safeMessage(error) } }));
    });
    return saved;
  };

  window.WLAccountEntitlements = {
    refresh,
    account,
    current: entitlement,
    currentOfflineSafe: effectiveCachedEntitlement,
    isProductPurchased: ownsProduct,
    listCloudSaves,
    uploadSlot,
    restoreSlot,
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
  PluginManager.registerCommand(pluginName, "uploadSave", args => {
    const savefileId = Math.max(1, Number(args.savefileId) || 1);
    uploadSlot(savefileId).catch(error => showError("Cloud upload failed", error, () => uploadSlot(savefileId)));
  });

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
