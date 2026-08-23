/*:
 * @target MZ
 * @plugindesc WonderLang account entitlements and entitlement-gated cloud save (duplicate integration build).
 * @author WonderLang
 *
 * @param ApiBaseUrl
 * @type string
 * @default https://wl-purchase-entitlement.netlify.app
 *
 * @help
 * Requires a native bridge named WLAccountManager with:
 *   getCachedIdToken(): string
 *   refreshIdToken(): boolean
 *   openSignIn(): boolean
 * The bridge calls window.WLAccountEntitlements._nativeToken(token) after refresh.
 *
 * This file is intentionally isolated from the production RPG Maker project.
 */
(() => {
  "use strict";
  const pluginName = "WonderLangAccountCloudSync";
  const params = PluginManager.parameters(pluginName);
  const apiBase = String(params.ApiBaseUrl || "https://wl-purchase-entitlement.netlify.app").replace(/\/$/, "");
  const cacheKey = "wl-account-entitlements-v1";
  const revisionsKey = "wl-cloud-revisions-v1";
  const textEncoder = new TextEncoder();
  let tokenWaiters = [];
  let current = loadCache();

  function bridge() { return window.WLAccountManager; }
  function loadCache() {
    try { return JSON.parse(localStorage.getItem(cacheKey) || "null"); }
    catch (_) { return null; }
  }
  function cache(value) {
    current = value;
    localStorage.setItem(cacheKey, JSON.stringify(value));
  }
  function revisions() {
    try { return JSON.parse(localStorage.getItem(revisionsKey) || "{}"); }
    catch (_) { return {}; }
  }
  function setRevision(slot, revision) {
    const value = revisions();
    value[slot] = revision;
    localStorage.setItem(revisionsKey, JSON.stringify(value));
  }
  async function idToken() {
    const immediate = String(bridge()?.getCachedIdToken?.() || "");
    if (immediate) return immediate;
    if (!bridge()?.refreshIdToken?.()) throw new Error("Sign in to your WonderLang account first.");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Account token refresh timed out.")), 15_000);
      tokenWaiters.push((token) => { clearTimeout(timeout); token ? resolve(token) : reject(new Error("Account sign-in is required.")); });
    });
  }
  async function request(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${await idToken()}`,
        "content-type": "application/json"
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Account request failed (${response.status}).`);
    return result;
  }
  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }
  function entitlement() { return current?.entitlements || current || null; }
  function ownsProduct(sku) {
    const value = entitlement();
    if (!value) return false;
    if (value.fullGame) return true;
    const chapter = /^wonderlangch([1-4])$/i.exec(String(sku || ""));
    return chapter ? (value.chapters || []).includes(Number(chapter[1])) : false;
  }
  async function refresh() {
    const me = await request("/api/v1/me");
    cache(me);
    window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: me.entitlements }));
    return me.entitlements;
  }
  async function saveBytes(savefileId) {
    const object = await StorageManager.loadObject(DataManager.makeSavename(savefileId));
    return textEncoder.encode(JSON.stringify(object));
  }
  async function uploadSlot(savefileId) {
    const value = entitlement();
    if (!value?.cloudSave) return { skipped: "not_entitled" };
    const slot = `save${savefileId}`;
    const bytes = await saveBytes(savefileId);
    const prepare = await request("/api/v1/cloud-saves/prepare-upload", {
      method: "POST",
      body: {
        slot,
        byteLength: bytes.byteLength,
        sha256: await sha256Hex(bytes),
        baseRevision: revisions()[slot] || null
      }
    });
    const upload = await fetch(prepare.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: bytes
    });
    if (!upload.ok) throw new Error(`Cloud upload failed (${upload.status}).`);
    const manifest = await request("/api/v1/cloud-saves/finalize", {
      method: "POST",
      body: { uploadId: prepare.uploadId }
    });
    setRevision(slot, manifest.currentRevision);
    return manifest;
  }
  async function restoreSlot(savefileId) {
    const slot = `save${savefileId}`;
    const remote = await request(`/api/v1/cloud-saves/${slot}`);
    const response = await fetch(remote.downloadUrl);
    if (!response.ok) throw new Error(`Cloud download failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== remote.manifest.byteLength || await sha256Hex(bytes) !== remote.manifest.sha256) {
      throw new Error("Downloaded cloud save failed its integrity check.");
    }
    const object = JSON.parse(new TextDecoder().decode(bytes));
    await StorageManager.saveObject(DataManager.makeSavename(savefileId), object);
    setRevision(slot, remote.manifest.currentRevision);
    return remote.manifest;
  }

  const originalSaveGame = DataManager.saveGame;
  DataManager.saveGame = async function(savefileId) {
    const saved = await originalSaveGame.call(this, savefileId);
    if (saved) uploadSlot(savefileId).catch((error) => {
      console.warn("[WonderLang Cloud Save] Local save succeeded; cloud upload did not.", error);
      window.dispatchEvent(new CustomEvent("wl-cloud-save-error", { detail: { savefileId, message: error.message } }));
    });
    return saved;
  };

  window.WLAccountEntitlements = {
    refresh,
    current: () => entitlement(),
    isProductPurchased: ownsProduct,
    uploadSlot,
    restoreSlot,
    openSignIn: () => Boolean(bridge()?.openSignIn?.()),
    _nativeToken(token) {
      const waiters = tokenWaiters;
      tokenWaiters = [];
      waiters.forEach((resolve) => resolve(String(token || "")));
      if (token) refresh().catch((error) => console.warn("[WonderLang Account] Entitlement refresh failed.", error));
    },
    _nativeSignedOut() {
      current = null;
      localStorage.removeItem(cacheKey);
      window.dispatchEvent(new CustomEvent("wl-entitlements-updated", { detail: null }));
    }
  };

  PluginManager.registerCommand(pluginName, "openSignIn", () => window.WLAccountEntitlements.openSignIn());
  PluginManager.registerCommand(pluginName, "refreshEntitlements", () => refresh().catch(console.warn));
})();
