//=============================================================================
// WL_SaveBackup.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc All-slot backups and recovery on desktop, Android and iOS. (v1.6)
 * @author WonderLang
 *
 * @command ExportBackup
 * @text Export Save Backup
 * @desc Creates a single .wlsaves file containing saves (and optionally config/global).
 *
 * @arg Scope
 * @text What to export
 * @type select
 * @option All save slots
 * @value all
 * @option One save slot
 * @value one
 * @default all
 *
 * @arg SavefileId
 * @text Save Slot (when Scope=one)
 * @type number
 * @min 0
 * @default 1
 *
 * @arg IncludeConfigAndGlobal
 * @text Include settings
 * @desc Matching save-slot headers are always included; this option also includes settings.
 * @type boolean
 * @default true
 *
 * @command ImportBackup
 * @text Import Save Backup
 * @desc Select a .wlsaves file and restore its contents (overwrites existing saves).
 *
 * @arg SkipConfirm
 * @text Skip overwrite confirmation
 * @type boolean
 * @default false
 *
 * @arg GoToTitle
 * @text Go to Title after import
 * @type boolean
 * @default true
 */

(() => {
  "use strict";

  const PLUGIN_NAME = "WL_SaveBackup";

  const HEADER_NEW = "WL_SAVES_V1";
  const ACCEPT_HEADERS = ["WL_SAVES_V1", "WL_BACKUP_V1"];
  const EXT = ".wlsaves";

  const AUTO_BACKUP_ENABLED = true;
  const AUTO_BACKUP_FILENAME = "Latest.wlsaves";
  const AUTO_BACKUP_DEBOUNCE_MS = 250;

  let _wl_autoTimer = null;
  let _wl_autoRunning = false;
  let _wl_autoQueued = false;
  let _wl_importing = false;
  let _wl_importAwaitingLoad = false;

  function specialSlotIds() {
    const configured = Number(window.VisuMZ?.SaveCore?.autoSaveSlotId);
    return [...new Set([0, 97, 98, Number.isInteger(configured) && configured >= 0 ? configured : 0])];
  }

  function slotId(key) {
    if (!/^file(?:0|[1-9]\d*)$/.test(key)) return null;
    const id = Number(key.slice(4));
    return Number.isSafeInteger(id) && id <= 10000 ? id : null;
  }

  function playableSave(value) {
    return value && typeof value === "object" &&
      ["system", "screen", "timer", "switches", "variables", "selfSwitches", "actors", "party", "map", "player"]
        .every(key => value[key] && typeof value[key] === "object") &&
      Number.isInteger(value.map._mapId) && value.map._mapId > 0 &&
      Number.isFinite(value.player._x) && Number.isFinite(value.player._y);
  }

  function leaderRawName() {
    try {
      const a = $gameParty?.members?.()[0];
      const n = a?.name?.();
      return (n == null) ? "" : String(n);
    } catch (_) { return ""; }
  }

  function wlDispatch(name, detail){
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch(_) {}
  }

  function safeReadablePart(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    let x = s;
    try { x = x.normalize("NFKD"); } catch (_) {}
    x = x.replace(/[\u0300-\u036f]/g, "");
    x = x.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    return x.slice(0, 24);
  }

  function fnv1a64HexUtf8(str) {
    const PRIME = 0x100000001b3n;
    let hash = 0xcbf29ce484222325n;
    try {
      if (window.TextEncoder) {
        const bytes = new TextEncoder().encode(String(str || ""));
        for (let i = 0; i < bytes.length; i++) {
          hash ^= BigInt(bytes[i]);
          hash = (hash * PRIME) & 0xFFFFFFFFFFFFFFFFn;
        }
      } else {
        const b = unescape(encodeURIComponent(String(str || "")));
        for (let i = 0; i < b.length; i++) {
          hash ^= BigInt(b.charCodeAt(i) & 0xFF);
          hash = (hash * PRIME) & 0xFFFFFFFFFFFFFFFFn;
        }
      }
    } catch (_) {}
    return hash.toString(16).padStart(16, "0");
  }

  function leaderFolderName() {
    const raw = leaderRawName();
    const readable = safeReadablePart(raw);
    const h = fnv1a64HexUtf8(raw);
    return `${readable || "Actor"}_${h}`;
  }

  function ensureDirSync(fs, dir) {
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }

  async function storedSaveNames() {
    if (StorageManager.isLocalMode()) {
      const fs = requireIfNw("fs"), dir = StorageManager.fileDirectoryPath();
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => n.endsWith(".rmmzsave")).map(n => n.slice(0,-9)) : [];
    }
    await StorageManager.updateForageKeys?.();
    const prefix = StorageManager.forageKey?.("");
    return prefix ? (StorageManager._forageKeys || []).filter(n => n.startsWith(prefix)).map(n => n.slice(prefix.length)) : [];
  }

  let backupRun = null;
  function backupRunId() {
    if (backupRun) return backupRun;
    try { backupRun = localStorage.getItem("wl-backup-run"); } catch (_) {}
    if (!backupRun || !/^[a-z0-9-]+$/.test(backupRun)) resetBackupRun();
    return backupRun;
  }
  function resetBackupRun() {
    backupRun = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem("wl-backup-run", backupRun); } catch (_) {}
  }
  async function writeAutoBackupNow() {
    if (_wl_importing || _wl_importAwaitingLoad || StorageManager._wlApplyingCloudProfile || !AUTO_BACKUP_ENABLED) return;
    const payload = await buildPayload("all", 1, false);
    if (_wl_importing || _wl_importAwaitingLoad || StorageManager._wlApplyingCloudProfile) return;
    const prefix = `wl-auto-backup-${backupRunId()}-`;
    const name = `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // StorageManager uses disk on desktop and persistent IndexedDB on mobile.
    await StorageManager.saveObject(name, payload);
    // Prune only this playthrough's rolling copies, after the new copy is durable.
    // Never prune pre-cloud/pre-recovery copies or a previous game's backups.
    const copies = (await storedSaveNames()).filter(n => n.startsWith(prefix)).sort().reverse();
    for (const old of copies.slice(10)) await StorageManager.remove(old);
    if (Utils.isNwjs() && StorageManager.isLocalMode()) {
      const fs = requireIfNw("fs"), path = requireIfNw("path");
      const dir = path.join(StorageManager.fileDirectoryPath(), leaderFolderName());
      ensureDirSync(fs, dir);
      fs.writeFileSync(path.join(dir, AUTO_BACKUP_FILENAME), encodePayloadToText(payload), "utf8");
    }
  }

  function scheduleAutoBackup() {
    if (_wl_importing || _wl_importAwaitingLoad) return;
    if (!AUTO_BACKUP_ENABLED || StorageManager._wlApplyingCloudProfile) return;
    if (_wl_autoTimer) clearTimeout(_wl_autoTimer);
    _wl_autoTimer = setTimeout(() => {
      _wl_autoTimer = null;
      runAutoBackupQueued();
    }, AUTO_BACKUP_DEBOUNCE_MS);
  }

  async function runAutoBackupQueued() {
    if (_wl_autoRunning) { _wl_autoQueued = true; return; }
    _wl_autoRunning = true;
    try { await writeAutoBackupNow(); } catch (error) { console.warn("[WL_SaveBackup] Local backup failed", error); } finally {
      _wl_autoRunning = false;
      if (_wl_autoQueued) {
        _wl_autoQueued = false;
        setTimeout(() => runAutoBackupQueued(), 0);
      }
    }
  }

  function isTrue(v) { return v === true || v === "true"; }

  // --- Translation System ---
  (function patchUiLanguageDetection() {
    if (!window.ConfigManager) return;
    if (ConfigManager._WL_uiLangPatched) return;
    ConfigManager._WL_uiLangPatched = true;
    const _applyData = ConfigManager.applyData;
    ConfigManager.applyData = function(config) {
      this._configHasUiLanguage = !!(config && Object.prototype.hasOwnProperty.call(config, "uiLanguage"));
      _applyData.call(this, config);
    };
  })();

  function _detectDeviceLangUpper2() {
    const raw = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    const map = { fr: "FR", es: "ES", de: "DE", pt: "PT", it: "IT", ko: "KR", kr: "KR", ja: "JP", jp: "JP", nl: "NL", zh: "ZH", id: "ID", ar: "AR", pl: "PL", uk: "UK", ua: "UK", ru: "RU", en: "EN" };
    return map[raw.slice(0, 2)] || "EN";
  }

  function ensureUiLanguageOptionOnce() {
    if (!window.ConfigManager) return;
    if (!ConfigManager._configHasUiLanguage) {
      ConfigManager.uiLanguage = _detectDeviceLangUpper2();
      ConfigManager._configHasUiLanguage = true;
      try { ConfigManager.save(); } catch (_) {}
    }
  }

  function getUiLanguageUpper2() {
    const code = String((window.ConfigManager && ConfigManager.uiLanguage) || "EN").toUpperCase();
    if (code === "ZH") {
      const mode172 = Number($gameVariables?.value?.(172) || 0);
      if (mode172 === 1 || mode172 === 2) return "ZH_hir";
      if (mode172 === 3 || mode172 === 4) return "ZH_trad";
    }
    return code;
  }

  let _menuTr = null;
  let _menuTrPromise = null;

  function loadMenuTranslationsOnce() {
    if (_menuTrPromise) return _menuTrPromise;
    _menuTrPromise = new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "texts/menu.json");
        xhr.overrideMimeType("application/json");
        xhr.onload = () => {
          if (xhr.status < 400) { try { _menuTr = JSON.parse(xhr.responseText).translations || JSON.parse(xhr.responseText); } catch (_) {} }
          resolve();
        };
        xhr.onerror = () => resolve();
        xhr.send();
      } catch (_) { resolve(); }
    });
    return _menuTrPromise;
  }

  function tr(key) {
    const L = getUiLanguageUpper2();
    const pool = _menuTr || {};
    if (pool[L] && pool[L][key] != null) return pool[L][key];
    const Llow = L.toLowerCase(), Lup = L.toUpperCase();
    if (pool[Llow]?.[key] != null) return pool[Llow][key];
    if (pool[Lup]?.[key] != null) return pool[Lup][key];
    if (pool.EN?.[key] != null) return pool.EN[key];
    if (pool.en?.[key] != null) return pool.en[key];
    return null;
  }

  function t(key, fallback) { return tr(key) || fallback; }

  const NULL_THEME = { primaryBg: null, secondaryBg: null, accentColor: null, buttonGradient: null, textColor: null, highlightColor: null };
  function computeTheme() { try { if (window.ColorThemeUtils?.computeThemeFromConfig) return ColorThemeUtils.computeThemeFromConfig() || NULL_THEME; } catch (_) {} return NULL_THEME; }
  function firstStopColor(gradient) {
    try { if (window.ColorThemeUtils?.firstStopColor) return ColorThemeUtils.firstStopColor(gradient); } catch (_) {}
    const m = String(gradient||"").match(/(#[0-9a-f]{6}|#[0-9a-f]{3}|rgba?\([^)]+\))/i);
    return m ? m[1] : "#f1c40f";
  }

  // --- UI ---
  const WL_UI = {
    _root: null, _toastTimer: null, _resolver: null, _mode: null,
    ensure() {
      if (this._root) return;
      const T = computeTheme();
      const highlight = T.highlightColor || firstStopColor(T.buttonGradient || "");
      const textColor = T.textColor || "#fff";
      const primaryBg = T.primaryBg || "rgba(0,0,0,.80)";
      const secondary = T.secondaryBg || "rgba(92,21,129,.80)";
      const buttonGrad = T.buttonGradient || "linear-gradient(135deg, #F1C40F 30%, #e56100 100%)";

      this._root = document.createElement("div");
      this._root.id = "wlSaveBackupUI";
      Object.assign(this._root.style, { position: "fixed", top: "0", right: "0", bottom: "0", left: "0", pointerEvents: "none", zIndex: 9999999 });

      this._root.innerHTML = `
<style>
  :root{ --wl-panel-bg:${primaryBg}; --wl-panel-bg-2:${secondary}; --wl-btn-grad:${buttonGrad}; --wl-text:${textColor}; --wl-hi:${highlight}; }
  #wlSaveBackupUI, #wlSaveBackupUI *{ font-family: 'NotoSans', system-ui, -apple-system, sans-serif !important; -webkit-text-stroke: 0 !important; box-sizing: border-box; }
  #wlSaveBackupUI .modal{ position:absolute; top:0; right:0; bottom:0; left:0; display:none; align-items:center; justify-content:center; background: rgba(0,0,0,.50); pointer-events:auto; }
  #wlSaveBackupUI .modal.open{ display:flex; }
  #wlSaveBackupUI .doc{ width: min(86vw, 860px); background: linear-gradient(180deg, var(--wl-panel-bg), var(--wl-panel-bg-2)); border-radius: 1rem; padding: .9rem; box-shadow: 0 2rem 4rem rgba(0,0,0,.35); display: grid; grid-template-rows: auto auto; gap: .7rem; color: var(--wl-text); }
  #wlSaveBackupUI .bar{ display:flex; align-items:center; justify-content:space-between; gap:.6rem; }
  #wlSaveBackupUI .ttl{ font-weight: 900; color: var(--wl-hi); font-size: 2rem; }
  #wlSaveBackupUI .body{ background: rgba(0,0,0,.25); border-radius: .9rem; padding: 1.05rem; line-height: 1.45; font-size: 2rem; color: var(--wl-text); overflow: auto; max-height: min(52vh, 640px); white-space: pre-line;}
  #wlSaveBackupUI .btnrow{ display:flex; gap: .6rem; justify-content: flex-end; flex-wrap: wrap; }
  #wlSaveBackupUI .btn{ border: 0; border-radius: .9rem; padding: .85rem 1.25rem; cursor: pointer; background: rgba(255,255,255,.12); color: #fff; font-weight: 900; font-size: 2rem; transition: transform .12s ease, box-shadow .2s ease, background .2s ease; }
  #wlSaveBackupUI .btn.primary{ background: var(--wl-btn-grad); }
  #wlSaveBackupUI .btn:hover{ transform: translateY(-.06rem); box-shadow: 0 .3rem .6rem rgba(0,0,0,.25); background: rgba(255,255,255,.16); }
  #wlSaveBackupUI .btn.primary:hover{ background: var(--wl-btn-grad); }
  #wlSaveBackupUI .toast{ position: absolute; left: 50%; bottom: 5vh; transform: translateX(-50%); min-width: min(76vw, 760px); max-width: min(86vw, 860px); background: linear-gradient(180deg, var(--wl-panel-bg), var(--wl-panel-bg-2)); border-radius: 1rem; padding: .8rem 1rem; color: var(--wl-text); box-shadow: 0 1.5rem 3rem rgba(0,0,0,.35); pointer-events: none; opacity: 0; transition: opacity .15s ease; }
  #wlSaveBackupUI .toast.show{ opacity: 1; }
  #wlSaveBackupUI .toast .t{ font-weight: 900; color: var(--wl-hi); margin-bottom: .25rem; }
  #wlSaveBackupUI .toast .m{ opacity: .98; }
</style>
<div class="modal" aria-hidden="true"><div class="doc" role="dialog" aria-modal="true"><div class="bar"><div class="ttl">Title</div></div><div class="body">Message</div><div class="btnrow"><button class="btn cancel" type="button">Cancel</button><button class="btn primary ok" type="button">OK</button></div></div></div>
<div class="toast" aria-hidden="true"><div class="t">WonderLang</div><div class="m">...</div></div>`;
      document.body.appendChild(this._root);
const modal = this._root.querySelector(".modal"), okBtn = this._root.querySelector(".btn.ok"), cancelBtn = this._root.querySelector(".btn.cancel");
      
      // The logic for what happens when clicked/tapped
      const handleOk = (e) => { 
          if (e) { e.preventDefault(); e.stopPropagation(); } 
          if (okBtn.disabled) return; 
          this._resolve(true); 
      };
      
      const handleCancel = (e) => { 
          if (e) { e.preventDefault(); e.stopPropagation(); } 
          if (cancelBtn.disabled) return; 
          this._resolve(false); 
      };

      bindRecoveryTap(okBtn, handleOk);
      bindRecoveryTap(cancelBtn, handleCancel);
      
      modal.addEventListener("click", (e) => { if (e.target === modal) this._resolve(false); });
      window.addEventListener("keydown", (e) => { if (this.isOpen() && e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this._resolve(false); } }, { capture: true });
    },
    isOpen() { return !!this._root?.querySelector(".modal")?.classList.contains("open"); },
    _open(mode, title, message) {
      this.ensure();
      this._mode = mode;
      if (this._root.querySelector(".ttl")) this._root.querySelector(".ttl").textContent = title || "";
      if (this._root.querySelector(".body")) this._root.querySelector(".body").textContent = message || "";
      const ok = this._root.querySelector(".btn.ok"), cancel = this._root.querySelector(".btn.cancel"), modal = this._root.querySelector(".modal");
      if (ok) ok.textContent = t("SaveBackup.OK", "OK");
      if (cancel) { cancel.textContent = t("SaveBackup.Cancel", "Cancel"); cancel.style.display = (mode === "confirm") ? "" : "none"; }
      if (modal) { modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); }
      if (ok) { ok.disabled = true; ok.style.pointerEvents = "none"; ok.style.opacity = "0.75"; }
      if (cancel) { cancel.disabled = true; cancel.style.pointerEvents = "none"; cancel.style.opacity = "0.75"; }
      setTimeout(() => {
        if (ok) { ok.disabled = false; ok.style.pointerEvents = ""; ok.style.opacity = ""; try { ok.focus(); } catch (_) {} }
        if (cancel) { cancel.disabled = false; cancel.style.pointerEvents = ""; cancel.style.opacity = ""; }
      }, 250);
    },
    _close() { const modal = this._root?.querySelector(".modal"); if (modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); } this._mode = null; },
    _resolve(value) { if (!this._resolver) { this._close(); return; } const r = this._resolver; this._resolver = null; this._close(); r(!!value); },
    alert(title, message) { return new Promise((resolve) => { this._resolver = resolve; this._open("alert", title, message); }); },
    confirm(title, message) { return new Promise((resolve) => { this._resolver = resolve; this._open("confirm", title, message); }); },
    toast(title, message, ms = 2200) {
      this.ensure();
      const box = this._root?.querySelector(".toast"); if (!box) return;
      this._root.querySelector(".toast .t").textContent = title || "WonderLang";
      this._root.querySelector(".toast .m").textContent = message || "";
      box.classList.add("show"); box.setAttribute("aria-hidden", "false");
      if (this._toastTimer) clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { box.classList.remove("show"); box.setAttribute("aria-hidden", "true"); }, ms);
    }
  };

  function makeHiddenFileInput(extraAttrs = {}) {
    const input = document.createElement("input");
    input.type = "file";
    Object.assign(input.style, { position: "fixed", top: "0", left: "0", width: "0", height: "0", opacity: "0", pointerEvents: "none", zIndex: "-1" });
    for (const k of Object.keys(extraAttrs)) input.setAttribute(k, extraAttrs[k]);
    document.body.appendChild(input);
    return input;
  }

  function requireIfNw(moduleName) {
    if (!Utils.isNwjs()) return null;
    try { return require(moduleName); } catch (e) { return null; }
  }

  function sanitizeIsoForFilename(iso) { return iso.replace(/[:.]/g, "-").replace("T", "_").replace("Z", ""); }
  function buildDefaultFilename() { return `SaveBackup_${sanitizeIsoForFilename(new Date().toISOString())}${EXT}`; }

  async function tryLoadObject(key) {
    try { return { ok: true, value: await StorageManager.loadObject(key) }; } catch (e) { return { ok: false, error: e }; }
  }

  const backupWrites = new Set();
  let backupGeneration = 0;
  async function buildPayload(scope, savefileId, includeConfigAndGlobal, attempt = 0) {
    await Promise.all([...backupWrites]);
    const generation = backupGeneration;
    const globalResult = await tryLoadObject("global");
    const global = globalResult.ok ? globalResult.value : [];
    const ids = new Set();
    if (scope === "one") {
      const id = slotId(`file${savefileId == null ? 1 : savefileId}`);
      if (id === null) throw new Error(t("SaveBackup.InvalidFile", "Invalid backup file."));
      ids.add(id);
    } else {
      specialSlotIds().forEach(id => ids.add(id));
      for (const name of await storedSaveNames()) { const id = slotId(name); if (id !== null) ids.add(id); }
      const max = Math.min(10000, Math.max(0, Number(DataManager.maxSavefiles?.()) || 20));
      for (let i = 1; i <= max; i++) ids.add(i);
      // Preserve valid slots created with an older/larger manual-slot configuration.
      for (const key of Object.keys(global || {})) {
        const id = slotId(`file${key}`);
        if (id !== null && global[key]) ids.add(id);
      }
    }
    const objects = {}, missing = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      const key = `file${id}`;
      const res = await tryLoadObject(key);
      if (res.ok && playableSave(res.value)) objects[key] = res.value;
      else {
        if (res.ok || await StorageManager.exists(key)) throw new Error(`${key}: ${t("SaveBackup.InvalidFile", "Invalid backup file.")}`);
        missing.push(key);
      }
    }
    if (!Object.keys(objects).length) throw new Error(t("Empty", "Empty"));
    // Include only headers backed by a real exported slot, even for single-slot exports.
    const headers = [];
    for (const key of Object.keys(objects)) headers[slotId(key)] = headerForSave(objects[key], global?.[slotId(key)]);
    objects.global = headers;
    if (includeConfigAndGlobal) {
      const config = await tryLoadObject("config");
      if (config.ok) objects.config = config.value;
    }
    if (backupWrites.size || generation !== backupGeneration) {
      if (attempt >= 3) throw new Error("Save files are busy; backup will be retried after the next save.");
      return buildPayload(scope, savefileId, includeConfigAndGlobal, attempt + 1);
    }
    return { magic: "WL_SAVES", version: 1, createdAt: new Date().toISOString(), engine: Utils?.RPGMAKER_NAME || "RPG Maker MZ", objects, missing };
  }

  function headerForSave(save, original) {
    const info = original && typeof original === "object" && !Array.isArray(original) ? {...original} : {};
    const actors = (save.party._actors || []).map(id => save.actors._data?.[id]).filter(Boolean);
    const leader = actors[0];
    const seconds = Math.max(0, Math.floor(Number(save.system._framesOnSave || 0) / 60));
    const pad = n => String(n).padStart(2, "0");
    return Object.assign(info, {
      title: info.title || $dataSystem.gameTitle,
      characters: actors.map(a => [a._characterName, a._characterIndex]),
      faces: actors.map(a => [a._faceName, a._faceIndex]),
      playtime: `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`,
      timestamp: Number.isFinite(Number(info.timestamp)) ? Number(info.timestamp) : Date.now(),
      mapId: save.map._mapId,
      langCode: String(save.variables._data?.[200] || ""),
      learnLevel: Number(save.variables._data?.[170] || 0),
      leaderLevel: Number(leader?._level || 0), gold: Number(save.party._gold || 0),
      leaderName: String(leader?._name || "")
    });
  }

  function validatePayload(payload) {
    if (!payload || payload.magic !== "WL_SAVES" || payload.version !== 1 ||
        !payload.objects || typeof payload.objects !== "object" || Array.isArray(payload.objects)) return null;
    const keys = Object.keys(payload.objects);
    if (keys.some(key => key !== "global" && key !== "config" && slotId(key) === null)) return null;
    const slots = keys.filter(key => slotId(key) !== null);
    if (!slots.length || slots.some(key => !playableSave(payload.objects[key]))) return null;
    if (keys.some(key => ["global", "config"].includes(key) && (!payload.objects[key] || typeof payload.objects[key] !== "object"))) return null;
    return slots;
  }

  async function restorePayload(payload) {
    const slots = validatePayload(payload);
    if (!slots) throw new Error(t("SaveBackup.InvalidFile", "Import failed: invalid backup file."));
    if (_wl_importing) throw new Error(t("SaveBackup.ImportRestoring", "Restoring saves..."));
    _wl_importing = true;
    StorageManager._wlRestoringBackup = true;
    if (_wl_autoTimer) { clearTimeout(_wl_autoTimer); _wl_autoTimer = null; }
    const old = new Map(), touched = [];
    const keys = [...slots, ...(Object.hasOwn(payload.objects, "config") ? ["config"] : []), "global"];
    try {
      for (const key of keys) {
        const saved = await tryLoadObject(key);
        if (!saved.ok && await StorageManager.exists(key)) throw saved.error;
        old.set(key, saved);
      }
      const local = old.get("global");
      const merged = Array.isArray(local.value) ? local.value.slice() : [];
      for (const key of slots) {
        const id = slotId(key);
        merged[id] = headerForSave(payload.objects[key], payload.objects.global?.[id]);
      }
      // Keep unrelated local saves AND their own labels; never copy an orphan header.
      for (const key of keys) {
        touched.push(key);
        await StorageManager.saveObject(key, key === "global" ? merged : payload.objects[key]);
      }
      DataManager._globalInfo = merged;
      _wl_importAwaitingLoad = true;
      return keys;
    } catch (error) {
      for (const key of touched.reverse()) {
        const previous = old.get(key);
        if (previous.ok) await StorageManager.saveObject(key, previous.value);
        else await StorageManager.remove(key);
      }
      throw error;
    } finally { _wl_importing = false; StorageManager._wlRestoringBackup = false; }
  }

  function base64EncodeUtf8(str) {
    if (window.TextEncoder) {
      const bytes = new TextEncoder().encode(str);
      let binary = ""; const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      return btoa(binary);
    }
    return btoa(unescape(encodeURIComponent(str)));
  }

  function base64DecodeUtf8(b64) {
    const binary = atob(b64);
    if (window.TextDecoder) {
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(escape(binary));
  }

  function encodePayloadToText(payload) {
    const packed = "B64:" + base64EncodeUtf8(JSON.stringify(payload));
    return `${HEADER_NEW}\n${packed}\n`;
  }

  function decodeTextToPayload(text) {
    const trimmed = String(text || "").trim();
    let content = trimmed;
    for (const h of ACCEPT_HEADERS) {
      if (trimmed.startsWith(h)) { content = trimmed.split("\n").slice(1).join("\n").trim(); break; }
    }
    try { return JSON.parse(content); } catch (e) {}
    if (content.startsWith("B64:")) return JSON.parse(base64DecodeUtf8(content.slice(4)));
    if (window.LZString?.decompressFromBase64) { const json = window.LZString.decompressFromBase64(content); if (json) return JSON.parse(json); }
    throw new Error("Could not decode this backup file.");
  }

  // Activate on release, never while beginning a scroll; shield RPG Maker TouchInput.
  function bindRecoveryTap(button, action) {
    let start = null, suppressUntil = 0;
    button.style.touchAction = "manipulation";
    button.addEventListener("touchstart", e => { e.stopPropagation(); const p = e.touches[0]; start = e.touches.length === 1 ? {x:p.clientX,y:p.clientY,moved:false} : null; }, {passive:true});
    button.addEventListener("touchmove", e => { e.stopPropagation(); const p=e.touches[0]; if(start && (e.touches.length!==1 || Math.hypot(p.clientX-start.x,p.clientY-start.y)>12)) start.moved=true; }, {passive:true});
    button.addEventListener("touchcancel", e => { e.stopPropagation(); start=null; suppressUntil=Date.now()+750; }, {passive:true});
    button.addEventListener("touchend", e => { e.stopPropagation(); if(e.cancelable)e.preventDefault(); const p=e.changedTouches[0]; const valid=start&&!start.moved&&p&&Math.hypot(p.clientX-start.x,p.clientY-start.y)<=12; start=null;suppressUntil=Date.now()+750;if(valid&&!button.disabled)action(e); }, {passive:false});
    button.addEventListener("click", e => { e.stopPropagation(); if(Date.now()<suppressUntil || button.disabled){e.preventDefault();return;} action(e); });
  }

  // Desktop automatic backups: current archives and older per-slot directories.
  function recoveryFolder(dir) {
    const fs = requireIfNw("fs"), path = requireIfNw("path");
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile());
    const archive = files.find(e => e.name === AUTO_BACKUP_FILENAME);
    const slots = files.filter(e => /^file(?:0|[1-9]\d*)\.rmmzsave$/.test(e.name) && slotId(e.name.slice(0, -9)) !== null);
    if (!archive && !slots.length) return null;
    const names = archive ? [archive.name] : slots.map(e => e.name).sort((a,b) => Number(a.slice(4,-9)) - Number(b.slice(4,-9)));
    return { dir, name: path.basename(dir), files: names, archive: !!archive,
      time: Math.max(...names.map(name => fs.statSync(path.join(dir, name)).mtimeMs)) };
  }

  function listRecoveryFolders() {
    const fs = requireIfNw("fs"), path = requireIfNw("path"), root = StorageManager.fileDirectoryPath();
    if (!fs.existsSync(root)) return [];
    const folders = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try { const folder = recoveryFolder(path.join(root, entry.name)); if (folder) folders.push(folder); } catch (_) {}
    }
    return folders.sort((a,b) => b.time - a.time || a.name.localeCompare(b.name));
  }

  async function listStoredRecoveryCopies() {
    const copies = [];
    for (const key of await storedSaveNames()) {
      if (!/^wl-(?:profile-recovery|auto-backup|recovery-before)-/.test(key)) continue;
      // Read metadata one copy at a time; never keep every full save in memory.
      try {
        const value = await StorageManager.loadObject(key);
        const files = value?.bundle?.files || value?.objects;
        if (!files || !Object.keys(files).some(n => slotId(n) !== null)) continue;
        const stamp = value.createdAt || value.bundle?.exportedAt;
        copies.push({ storageKey: key, dir: key,
          name: value.binding?.profileName || value.binding?.name || t("SaveBackup.Title", "Save Backup"),
          files: Object.keys(files).filter(n => slotId(n) !== null),
          time: Date.parse(stamp) || Number(key.match(/-(\d{13})-/)?.[1]) || 0 });
      } catch (error) { console.warn("[WL_SaveBackup] Unreadable recovery copy", key, error); }
    }
    return copies;
  }

  async function readRecoveryFolder(folder) {
    if (folder.storageKey) {
      const value = await StorageManager.loadObject(folder.storageKey);
      let payload = value;
      if (value?.bundle?.magic === "WL_CLOUD_PROFILE" && value.bundle.version === 1) {
        const objects = {}, headers = [];
        for (const [name, json] of Object.entries(value.bundle.files || {})) {
          if (slotId(name) === null) continue;
          const save = await StorageManager.jsonToObject(json);
          if (!playableSave(save)) throw new Error(t("SaveBackup.InvalidFile", "Invalid backup file."));
          objects[name] = save;
          headers[slotId(name)] = headerForSave(save, { timestamp: folder.time });
        }
        objects.global = headers;
        payload = { magic: "WL_SAVES", version: 1, objects };
      }
      if (!validatePayload(payload)) throw new Error(t("SaveBackup.InvalidFile", "Invalid backup file."));
      const objects = { ...payload.objects }; delete objects.config;
      return { ...payload, objects };
    }
    const fs = requireIfNw("fs"), path = requireIfNw("path");
    // Re-read the inventory: the folder may have changed while the picker was open.
    folder = recoveryFolder(folder.dir);
    if (!folder) throw new Error(t("SaveBackup.RecoveryEmpty", "No save backups found in this folder."));
    let payload;
    if (folder.archive) payload = decodeTextToPayload(fs.readFileSync(path.join(folder.dir, AUTO_BACKUP_FILENAME), "utf8"));
    else {
      const objects = {}, headers = [];
      for (const name of folder.files) {
        const key = name.slice(0, -9), file = path.join(folder.dir, name);
        const json = await StorageManager.zipToJson(fs.readFileSync(file, "utf8"));
        const save = await StorageManager.jsonToObject(json);
        if (!playableSave(save)) throw new Error(`${name}: ${t("SaveBackup.InvalidFile", "Invalid backup file.")}`);
        objects[key] = save;
        headers[slotId(key)] = headerForSave(save, { timestamp: fs.statSync(file).mtimeMs });
      }
      objects.global = headers;
      payload = { magic: "WL_SAVES", version: 1, objects };
    }
    if (!validatePayload(payload)) throw new Error(t("SaveBackup.InvalidFile", "Invalid backup file."));
    // Recovery restores progress, never old device/language preferences.
    payload = { ...payload, objects: { ...payload.objects } };
    delete payload.objects.config;
    return payload;
  }

  function preserveSavesBeforeRecovery() {
    if (!StorageManager.isLocalMode()) return (async () => {
      const names = await storedSaveNames();
      if (!names.some(n => slotId(n) !== null)) return;
      const payload = await buildPayload("all", 1, false);
      await StorageManager.saveObject(`wl-recovery-before-${Date.now()}-${Math.random().toString(36).slice(2)}`, payload);
    })();
    const fs = requireIfNw("fs"), path = requireIfNw("path"), root = StorageManager.fileDirectoryPath();
    if (!fs.existsSync(root)) return;
    const files = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile() && /^(?:file\d+|global)\.rmmzsave$/.test(e.name));
    if (!files.length) return;
    const dir = path.join(root, `RecoveryBefore_${sanitizeIsoForFilename(new Date().toISOString())}_${Math.random().toString(36).slice(2,8)}`);
    fs.mkdirSync(dir); // Fail before touching saves if their safety copy cannot be written.
    for (const entry of files) fs.copyFileSync(path.join(root, entry.name), path.join(dir, entry.name));
  }

  let _recoveryPromise = null;
  function openRecovery() {
    if (_recoveryPromise) return _recoveryPromise;
    _recoveryPromise = showRecoveryPicker().finally(() => { _recoveryPromise = null; });
    return _recoveryPromise;
  }

  async function showRecoveryPicker() {
    await loadMenuTranslationsOnce();
    await window.WLAccountEntitlements?.waitForCloudIdle?.();
    while (_wl_autoRunning) await new Promise(resolve=>setTimeout(resolve,20));
    const folders = [...(StorageManager.isLocalMode() ? listRecoveryFolders() : []), ...await listStoredRecoveryCopies()]
      .sort((a,b) => b.time - a.time);
    const previousFocus = document.activeElement;
    const root = document.createElement("div"); root.id = "wlSaveRecovery";
    const theme = computeTheme();
    root.style.setProperty("--recovery-thumb", theme.buttonGradient || "linear-gradient(135deg,#f1c40f,#ed8936)");
    root.style.setProperty("--recovery-track", theme.secondaryBg || "#271330");
    root.innerHTML = `<style>
      #wlSaveRecovery{position:fixed;inset:0;z-index:9999998;background:#000b;display:grid;place-items:center;color:white;font-family:'NotoSans',sans-serif}
      #wlSaveRecovery *{box-sizing:border-box;-webkit-text-stroke:0}
      #wlSaveRecovery .recovery-panel{width:min(92vw,960px);max-height:92vh;display:flex;flex-direction:column;gap:14px;padding:22px;border-radius:18px;background:linear-gradient(145deg,#351345,#170d24);box-shadow:0 12px 50px #0008}
      #wlSaveRecovery h2{margin:0;color:#ffd25e;font-size:clamp(22px,3vh,32px)}
      #wlSaveRecovery p{margin:0;font-size:clamp(16px,2.3vh,22px)}
      #wlSaveRecovery .recovery-scroll{position:relative;min-height:60px;display:flex;flex:1;overflow:hidden}
      #wlSaveRecovery .recovery-list{overflow:auto;min-height:0;min-width:0;flex:1;display:grid;gap:10px;padding:4px 28px 4px 4px;scrollbar-width:none;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y}
      #wlSaveRecovery .recovery-list::-webkit-scrollbar{display:none}
      #wlSaveRecovery .recovery-track{position:absolute;right:2px;top:4px;bottom:4px;width:18px;border:1px solid #ffffff25;border-radius:10px;background:var(--recovery-track);touch-action:none}
      #wlSaveRecovery .recovery-track[hidden]{display:none}
      #wlSaveRecovery .recovery-thumb{position:absolute;left:2px;right:2px;min-height:28px;border-radius:8px;background:var(--recovery-thumb);box-shadow:0 1px 5px #0008;touch-action:none;cursor:grab}
      #wlSaveRecovery .recovery-thumb:focus-visible{outline:2px solid white;outline-offset:1px}
      #wlSaveRecovery button{font:inherit;font-size:clamp(16px,2.3vh,22px);color:white;border:1px solid #ffffff38;background:#ffffff12;border-radius:10px;padding:12px 16px;cursor:pointer}
      #wlSaveRecovery button:focus-visible{outline:3px solid #ffd25e;outline-offset:1px}
      #wlSaveRecovery button:disabled{opacity:.55;cursor:default}
      #wlSaveRecovery .recovery-folder{text-align:start;overflow-wrap:anywhere;display:grid;gap:5px}
      #wlSaveRecovery .recovery-folder[aria-pressed=true]{border-color:#ffd25e;background:#713b86}
      #wlSaveRecovery small{font-size:.85em;opacity:.85}
      #wlSaveRecovery .recovery-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}
      #wlSaveRecovery .recovery-restore{background:linear-gradient(135deg,#cc8900,#d85a17);font-weight:700}
    </style><section class="recovery-panel" role="dialog" aria-modal="true" aria-labelledby="wlRecoveryTitle"><h2 id="wlRecoveryTitle"></h2><p class="recovery-hint"></p><div class="recovery-scroll"><div class="recovery-list" id="wlRecoveryList"></div><div class="recovery-track" hidden><div class="recovery-thumb" role="scrollbar" tabindex="0" aria-controls="wlRecoveryList" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"></div></div></div><div class="recovery-actions"><button class="recovery-browse" type="button"></button><button class="recovery-cancel" type="button"></button><button class="recovery-restore" type="button" disabled></button></div></section>`;
    const find = s => root.querySelector(s);
    find("h2").textContent = t("SaveBackup.RecoverButton", "Recover save");
    find(".recovery-hint").textContent = t("SaveBackup.ChooseFolder", "Choose a backup folder to recover your saves from.");
    find(".recovery-browse").textContent = t("SaveBackup.BrowseFolder", "Browse folders");
    find(".recovery-cancel").textContent = t("SaveBackup.Cancel", "Cancel");
    find(".recovery-restore").textContent = t("SaveBackup.RecoverButton", "Recover save");
    find(".recovery-panel").dir = "auto";
    find(".recovery-browse").hidden = !StorageManager.isLocalMode();
    find(".recovery-thumb").setAttribute("aria-label", t("SaveBackup.ChooseFolder", "Choose a backup folder to recover your saves from."));
    let selected = null, busy = false, input = null, finished = false;
    document.body.appendChild(root);
    const list=find(".recovery-list"),track=find(".recovery-track"),thumb=find(".recovery-thumb");
    const syncScroll=()=>{const max=list.scrollHeight-list.clientHeight;track.hidden=max<=1;const h=Math.max(28,track.clientHeight*list.clientHeight/Math.max(1,list.scrollHeight));thumb.style.height=`${h}px`;thumb.style.top=`${max>0?(track.clientHeight-h)*list.scrollTop/max:0}px`;thumb.setAttribute("aria-valuenow",String(max>0?Math.round(100*list.scrollTop/max):0));};
    list.addEventListener("scroll",syncScroll,{passive:true});
    for(const type of ["touchstart","touchmove","touchend"])list.addEventListener(type,e=>e.stopPropagation(),{passive:true});
    for(const type of ["touchstart","touchmove","touchend"])track.addEventListener(type,e=>e.stopPropagation(),{passive:true});
    let drag=null;
    track.addEventListener("pointerdown",e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();const r=thumb.getBoundingClientRect();drag={id:e.pointerId,offset:e.target===thumb?e.clientY-r.top:r.height/2};track.setPointerCapture(e.pointerId);moveThumb(e);});
    const moveThumb=e=>{if(drag?.id!==e.pointerId)return;const span=track.clientHeight-thumb.offsetHeight;if(span>0)list.scrollTop=Math.max(0,Math.min(1,(e.clientY-track.getBoundingClientRect().top-drag.offset)/span))*(list.scrollHeight-list.clientHeight);};
    track.addEventListener("pointermove",moveThumb);for(const type of ["pointerup","pointercancel","lostpointercapture"])track.addEventListener(type,()=>drag=null);
    thumb.addEventListener("keydown",e=>{const deltas={ArrowDown:40,ArrowUp:-40,PageDown:list.clientHeight,PageUp:-list.clientHeight,Home:-list.scrollHeight,End:list.scrollHeight};if(e.key in deltas){e.preventDefault();e.stopPropagation();list.scrollTop+=deltas[e.key];}});
    const observer=new ResizeObserver(syncScroll);observer.observe(list);observer.observe(track);new Promise(r=>requestAnimationFrame(r)).then(syncScroll);
    Input.clear(); TouchInput.clear();
    return new Promise(resolve => {
      let lastDomKeyAt=0;
      const close = result => {
        if (finished) return;
        finished = true; observer.disconnect(); cancelAnimationFrame(navFrame); input?.remove(); root.remove(); window.removeEventListener("keydown", keyHandler, true);
        Input.clear(); TouchInput.clear(); previousFocus?.focus?.(); resolve(result);
      };
      const keyHandler = e => {
        lastDomKeyAt=Date.now();
        if (WL_UI.isOpen()) return; // The confirmation/alert owns keyboard focus.
        if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); if (!busy) close(false); return; }
        if (e.key === "Tab") {
          const buttons = [...root.querySelectorAll("button:not(:disabled),[role=scrollbar]")].filter(b=>b.offsetHeight>0);
          const index = buttons.indexOf(document.activeElement);
          e.preventDefault(); e.stopImmediatePropagation();
          buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
        }
        if (["ArrowDown","ArrowUp","ArrowLeft","ArrowRight"].includes(e.key) && document.activeElement!==thumb) {
          const buttons=[...root.querySelectorAll("button:not(:disabled)")].filter(b=>b.offsetHeight>0), index=buttons.indexOf(document.activeElement);
          e.preventDefault();e.stopImmediatePropagation();
          buttons[(index+(["ArrowUp","ArrowLeft"].includes(e.key)?-1:1)+buttons.length)%buttons.length]?.focus();
        }
      };
      window.addEventListener("keydown", keyHandler, true);
      const addFolder = folder => {
        const button = document.createElement("button"); button.type = "button"; button.className = "recovery-folder"; button.setAttribute("aria-pressed", "false");
        const name = document.createElement("strong"), detail = document.createElement("small");
        button.dir = "auto"; detail.dir = "auto";
        name.textContent = folder.name;
        detail.textContent = `${new Date(folder.time).toLocaleString()} · ${folder.files.join(", ")}`;
        button.append(name, detail); button.title = folder.dir;
        bindRecoveryTap(button, () => {
          if (busy) return;
          selected = folder;
          root.querySelectorAll(".recovery-folder").forEach(b => b.setAttribute("aria-pressed", String(b === button)));
          find(".recovery-restore").disabled = false;
        });
        find(".recovery-list").appendChild(button);
        return button;
      };
      const showError = async error => { await WL_UI.alert(t("SaveBackup.RecoverButton", "Recover save"), `${t("SaveBackup.ImportFailed", "Import failed:")} ${error.message || error}`); if (!finished) find(".recovery-cancel").focus(); };
      try {
        folders.forEach(addFolder);
        if (!folders.length) { const empty = document.createElement("p"); empty.className = "recovery-empty"; empty.textContent = t("SaveBackup.RecoveryEmpty", "No save backups found in this folder."); find(".recovery-list").appendChild(empty); }
      } catch (error) { showError(error); }
      bindRecoveryTap(find(".recovery-cancel"), () => { if (!busy) close(false); });
      bindRecoveryTap(find(".recovery-browse"), () => {
        if (busy) return;
        input?.remove(); input = makeHiddenFileInput({ nwdirectory: "", nwdirectorydesc: t("SaveBackup.ChooseFolder", "Choose a backup folder to recover your saves from."), nwworkingdir: StorageManager.fileDirectoryPath() });
        const picker = input;
        picker.addEventListener("cancel", () => picker.remove(), { once:true });
        picker.addEventListener("change", async () => {
          const dir = picker.value; picker.remove(); if (!dir || finished) return;
          try {
            const folder = recoveryFolder(dir);
            if (!folder) throw new Error(t("SaveBackup.RecoveryEmpty", "No save backups found in this folder."));
            find(".recovery-empty")?.remove(); const button = addFolder(folder); button.click(); button.focus();
          } catch (error) { await showError(error); }
        }, { once:true }); picker.click();
      });
      bindRecoveryTap(find(".recovery-restore"), async () => {
        if (busy || !selected) return;
        busy = true; root.querySelectorAll("button").forEach(b => b.disabled = true);
        try {
          const payload = await readRecoveryFolder(selected);
          const ok = await WL_UI.confirm(t("SaveBackup.RecoverButton", "Recover save"), `${selected.name}\n\n${t("SaveBackup.OverwriteConfirm", "This will overwrite your current saves. Continue?")}`);
          if (ok) {
            await preserveSavesBeforeRecovery();
            const keys = await restorePayload(payload);
            WL_UI.toast(t("SaveBackup.RecoverButton", "Recover save"), t("SaveBackup.ImportComplete", "Import complete."), 2200);
            wlDispatch("WL_SaveBackup:ImportComplete", { keys, goToTitle: false });
            close(true); return;
          }
        } catch (error) { await showError(error); }
        finally { if (!finished) { busy = false; root.querySelectorAll("button").forEach(b => b.disabled = false); find(".recovery-restore").focus(); } }
      });
      let navFrame=0;
      const pollNav=()=>{if(finished)return;if(Date.now()-lastDomKeyAt>150){const owner=WL_UI.isOpen()?WL_UI._root:root;const buttons=[...owner.querySelectorAll('button:not(:disabled)')].filter(b=>b.offsetHeight>0);const active=buttons.indexOf(document.activeElement);if(Input.isRepeated('down')||Input.isRepeated('right'))buttons[(active+1)%buttons.length]?.focus();else if(Input.isRepeated('up')||Input.isRepeated('left'))buttons[(active-1+buttons.length)%buttons.length]?.focus();if(Input.isTriggered('ok')){document.activeElement?.click?.();}if(Input.isTriggered('cancel')){if(WL_UI.isOpen())WL_UI._resolve(false);else if(!busy)close(false);}}navFrame=requestAnimationFrame(pollNav);};
      navFrame=requestAnimationFrame(pollNav);
      if (!WL_UI.isOpen()) (find(".recovery-folder") || find(".recovery-cancel")).focus();
    });
  }
  window.WLSaveBackup = { openRecovery, bindTap:bindRecoveryTap, isRecoveryOpen: () => !!_recoveryPromise };

  async function exportBackup(args) {
    ensureUiLanguageOptionOnce();
    const trPromise = loadMenuTranslationsOnce();
    const scope = (args.Scope || "all").toLowerCase() === "one" ? "one" : "all";
    const payload = await buildPayload(scope, Number(args.SavefileId || 1), isTrue(args.IncludeConfigAndGlobal));
    const fileText = encodePayloadToText(payload);
    const defaultName = buildDefaultFilename();

    await trPromise;

    // --- NATIVE ANDROID EXPORT ---
    if (typeof window.AndroidManager !== "undefined" && window.AndroidManager.exportBackup) {
      window.AndroidManager.exportBackup(defaultName, fileText);
      WL_UI.toast(t("SaveBackup.Title", "Save Backup"), t("SaveBackup.ExportStarted", "Opening Android save dialog..."), 2200);
      return;
    }

    WL_UI.toast(t("SaveBackup.Title", "Save Backup"), t("SaveBackup.Exporting", "Preparing save backup..."), 1400);

    if (Utils.isNwjs()) {
      const fs = requireIfNw("fs");
      if (!fs) { await WL_UI.alert(t("SaveBackup.Title", "Save Backup"), t("SaveBackup.ExportFsMissing", "Export failed: filesystem access is not available.")); return; }
      const input = makeHiddenFileInput({ accept: `${EXT},.txt,.json`, nwsaveas: defaultName });
      input.addEventListener("change", async () => {
        try {
          const outPath = input.value; input.remove();
          if (!outPath) { WL_UI.toast(t("SaveBackup.Title", "Save Backup"), t("SaveBackup.ExportCancelled", "Export cancelled."), 1600); return; }
          fs.writeFileSync(outPath, fileText, "utf8");
          WL_UI.toast(t("SaveBackup.Title", "Save Backup"), `${t("SaveBackup.ExportSaved", "Backup exported:")} ${outPath}`, 2600);
        } catch (e) {
          try { input.remove(); } catch (_) {}
          await WL_UI.alert(t("SaveBackup.Title", "Save Backup"), `${t("SaveBackup.ExportFailed", "Export failed:")} ${e && e.message ? e.message : String(e)}`);
        }
      }, { once: true });
      input.click();
    } else {
      try {
        const blob = new Blob([fileText], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = defaultName;
        document.body.appendChild(a); a.click();
        setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
        WL_UI.toast(t("SaveBackup.Title", "Save Backup"), t("SaveBackup.ExportStarted", "Backup download started."), 2200);
      } catch (e) {
        await WL_UI.alert(t("SaveBackup.Title", "Save Backup"), `${t("SaveBackup.ExportFailed", "Export failed:")} ${e && e.message ? e.message : String(e)}`);
      }
    }
  }

  function importBackup(args) {
    const skipConfirm = isTrue(args.SkipConfirm);
    const goToTitle = isTrue(args.GoToTitle);

    const doRestore = async (payload) => {
      await loadMenuTranslationsOnce();
      if (!validatePayload(payload)) {
        await WL_UI.alert(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.InvalidFile", "Import failed: invalid backup file."));
        wlDispatch("WL_SaveBackup:ImportCancelled", { reason: "invalid_or_empty_backup" });
        return;
      }
      if (!skipConfirm) {
        const ok = await WL_UI.confirm(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.OverwriteConfirm", "This will overwrite your current saves. Continue?"));
        if (!ok) {
          WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportCancelled", "Import cancelled."), 1600);
          wlDispatch("WL_SaveBackup:ImportCancelled", { reason: "user_cancelled_confirm" });
          return;
        }
      }
      WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportRestoring", "Restoring saves..."), 1600);
      const keys = await restorePayload(payload);
      if (keys.includes("config")) { try { await ConfigManager.load(); } catch (_) {} }
      WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportComplete", "Import complete."), 2200);
      wlDispatch("WL_SaveBackup:ImportComplete", { keys, goToTitle: !!goToTitle });
      if (goToTitle && typeof Scene_Title !== "undefined") { SceneManager.goto(Scene_Title); } else {
        WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ReturnToTitle", "Return to the Title screen to refresh the save list."), 2600);
      }
    };

    // --- NATIVE ANDROID IMPORT ---
    if (typeof window.AndroidManager !== "undefined" && window.AndroidManager.importBackup) {
      window.WL_ImportData = async (b64) => {
        try {
          const text = base64DecodeUtf8(b64);
          const payload = decodeTextToPayload(text);
          await doRestore(payload);
        } catch (e) {
          await loadMenuTranslationsOnce();
          await WL_UI.alert(t("SaveBackup.ImportTitle", "Import Save Backup"), `${t("SaveBackup.ImportFailed", "Import failed:")} ${e && e.message ? e.message : String(e)}`);
        }
      };
      
      window.WL_ImportCancel = async () => {
        await loadMenuTranslationsOnce();
        WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportCancelled", "Import cancelled."), 1600);
        wlDispatch("WL_SaveBackup:ImportCancelled", { reason: "user_cancelled_android" });
      };

      window.AndroidManager.importBackup();
      return;
    }

    if (Utils.isNwjs()) {
      const fs = requireIfNw("fs");
      if (!fs) { loadMenuTranslationsOnce().then(() => { WL_UI.alert(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportFsMissing", "Import failed: filesystem access is not available.")); }); return; }
      const input = makeHiddenFileInput({ accept: `${EXT},.txt,.json,*/*` });
      input.addEventListener("change", async () => {
        try {
          const inPath = input.value; input.remove();
          if (!inPath) {
            await loadMenuTranslationsOnce();
            WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportCancelled", "Import cancelled."), 1600);
            wlDispatch("WL_SaveBackup:ImportCancelled", { reason: "no_file_selected" }); return;
          }
          const text = fs.readFileSync(inPath, "utf8");
          await doRestore(decodeTextToPayload(text));
        } catch (e) {
          try { input.remove(); } catch (_) {}
          await loadMenuTranslationsOnce(); await WL_UI.alert(t("SaveBackup.ImportTitle", "Import Save Backup"), `${t("SaveBackup.ImportFailed", "Import failed:")} ${e && e.message ? e.message : String(e)}`);
        }
      }, { once: true });
      input.click(); 
    } else {
      const input = makeHiddenFileInput({ accept: `${EXT},.txt,.json,*/*` });
      const onPickerChange = async () => {
        try {
          const file = input.files && input.files[0]; input.remove();
          if (!file) {
            await loadMenuTranslationsOnce();
            WL_UI.toast(t("SaveBackup.ImportTitle", "Import Save Backup"), t("SaveBackup.ImportCancelled", "Import cancelled."), 1600);
            wlDispatch("WL_SaveBackup:ImportCancelled", { reason: "no_file_selected" }); return;
          }
          const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Failed to read file."));
            reader.onload = () => resolve(String(reader.result || ""));
            reader.readAsText(file);
          });
          await doRestore(decodeTextToPayload(text));
        } catch (e) {
          try { input.remove(); } catch (_) {}
          await loadMenuTranslationsOnce(); await WL_UI.alert(t("SaveBackup.ImportTitle", "Import Save Backup"), `${t("SaveBackup.ImportFailed", "Import failed:")} ${e && e.message ? e.message : String(e)}`);
        }
      };
      input.addEventListener("change", onPickerChange, { once: true });
      input.click(); 
    }
  }

  PluginManager.registerCommand(PLUGIN_NAME, "ExportBackup", (args) => {
    exportBackup(args).catch(async (e) => {
      ensureUiLanguageOptionOnce(); await loadMenuTranslationsOnce();
      await WL_UI.alert(t("SaveBackup.Title", "Save Backup"), `${t("SaveBackup.ExportFailed", "Export failed:")} ${e && e.message ? e.message : String(e)}`);
    });
  });

  PluginManager.registerCommand(PLUGIN_NAME, "ImportBackup", (args) => {
    try { importBackup(args); } catch (e) {
      loadMenuTranslationsOnce().then(() => { WL_UI.alert(t("SaveBackup.ImportTitle", "Import Save Backup"), `${t("SaveBackup.ImportFailed", "Import failed:")} ${e && e.message ? e.message : String(e)}`); });
    }
  });

  const _WL_DataManager_saveGame = DataManager.saveGame;
  DataManager.saveGame = async function(savefileId) {
    if (_wl_importing || (_wl_importAwaitingLoad && specialSlotIds().includes(Number(savefileId)))) return false;
    const ok = await _WL_DataManager_saveGame.call(this, savefileId);
    if (ok) scheduleAutoBackup();
    return ok;
  };

  const _WL_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function() {
    const result = _WL_extractSaveContents.apply(this, arguments);
    _wl_importAwaitingLoad = false;
    return result;
  };
  const _WL_setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function() {
    const result = _WL_setupNewGame.apply(this, arguments);
    resetBackupRun();
    _wl_importAwaitingLoad = false;
    return result;
  };

  const _WL_StorageManager_saveObject = StorageManager.saveObject;
  StorageManager.saveObject = async function(name, object) {
    const managed = name === "global" || slotId(String(name)) !== null;
    const pending = Promise.resolve().then(() => _WL_StorageManager_saveObject.call(this, name, object));
    if (managed) { backupWrites.add(pending); backupGeneration++; }
    try {
      const result = await pending;
      if (managed) scheduleAutoBackup();
      return result;
    } finally { backupWrites.delete(pending); }

  };

  const _WL_StorageManager_saveToLocalFile = StorageManager.saveToLocalFile;
  StorageManager.saveToLocalFile = async function(saveName, json) {
    const result = await _WL_StorageManager_saveToLocalFile.call(this, saveName, json);
    if (/^file\d+$/i.test(String(saveName || ""))) scheduleAutoBackup();
    return result;
  };
})();
