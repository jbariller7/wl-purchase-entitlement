//=============================================================================
// SaveLoadHTML.js  v1.5  (NW.js file-mode + VS Save Core compatible)
//=============================================================================
/*:
 * @target MZ
 * @plugindesc HTML Save/Load UI (2 rows; autosave row first). White outlines, taller cards, mobile-friendly. Works with VisuStella Save Core & NW.js file saves.
 * @author WonderLang
 * @help
 * v1.5
 * • Robust header discovery in this order:
 *   1) DataManager.loadGlobalInfo()
 *   2) StorageManager.loadObject('global')  (some plugins override this)
 *   3) NW.js filesystem probe: fileDirectoryPath()/file%1.rmmzsave presence
 *   4) Web LocalMode fallback (localStorage rmmzsave.file%1[.info])
 * • If a slot exists but header is unavailable, shows “Present” and allows loading.
 * • Cards show: leader sprite (animated), learned language (Var 200), learning mode (Var 170),
 *   leader level, gold, saved time, playtime. Translated via texts/menu.json.
 * Place BELOW: VisuStella Save Core, ColorThemeUtils, Ignis.TextDatabase.
 * 
 *  @command AltAutosaveNow
 * @text Alternative Autosave Now
 * @desc Saves to the extra autosave slot (Autosave B). Call this regularly to keep a backup autosave.

 */

(() => {
  "use strict";

  // ---------- Labels ----------
  const LANG_NATIVE = {
    EN:"English", FR:"Français", ES:"Español", DE:"Deutsch", PT:"Português",
    IT:"Italiano", KR:"한국어", JP:"日本語", NL:"Nederlands", ZH:"中文",
    ID:"Bahasa Indonesia", AR:"العربية", PL:"Polski", UK:"Українська", RU:"Русский"
  };
  const LEVEL_NAMES = {
    DEFAULT: { 0:"Very Beginner", 1:"A1",      2:"A2" },
    FR:      { 0:"Very Beginner", 1:"A1",      2:"A2" },
    KR:      { 0:"Very Beginner", 1:"TOPIK I", 2:"TOPIK II" }
  };
 const normLearn = c => {
  const v = String(c || "").toUpperCase();
  return (v === "JP_HIR" || v === "ZH_HIR" || v === "ZH_TRAD" || v === "AR_HIR") ? v.split("_")[0] : v;
};
 const langWithZhVariant = c => {
  const v = String(c || "EN").trim();
  if (v.toUpperCase() === "ZH") {
    const mode172 = Number($gameVariables?.value?.(172) || 0);
    if (mode172 === 1 || mode172 === 2) return "ZH_hir";
    if (mode172 === 3 || mode172 === 4) return "ZH_trad";
    return "ZH";
  }
  return v;
};

  const levelNameFor = (code, m) => (LEVEL_NAMES[normLearn(code)] || LEVEL_NAMES.DEFAULT)[Number(m||0)|0] ?? String(m);

  // ---------- Translations ----------
  let menuTranslations = null;
  const tdb = s => { try{ if (window.Ignis?.TextDatabase?.replaceText && typeof s==="string") return Ignis.TextDatabase.replaceText(s); }catch(_){ } return s; };
  function tr(k){
    const L = langWithZhVariant(ConfigManager?.uiLanguage || "EN");
    if (!menuTranslations) return k;
    for (const c of [L, L.toLowerCase(), L.toUpperCase()]) if (menuTranslations[c]?.[k] != null) return menuTranslations[c][k];
    return menuTranslations.en?.[k] ?? k;
  }
  function loadMenuTranslations(){
    return new Promise(res=>{
      try{
        const xhr = new XMLHttpRequest();
        xhr.open("GET","texts/menu.json"); xhr.overrideMimeType("application/json");
        xhr.onload=()=>{ if(xhr.status<400){ const d=JSON.parse(xhr.responseText); menuTranslations=d.translations||d; } res(); };
        xhr.onerror=res; xhr.send();
      }catch(_){ res(); }
    });
  }

  // ---------- Theme ----------
  const NULL_THEME = {primaryBg:null,secondaryBg:null,buttonGradient:null,textColor:null,highlightColor:null};
  const computeTheme = () => (window.ColorThemeUtils && ColorThemeUtils.computeThemeFromConfig()) || NULL_THEME;
  function firstStopColor(grad){
    try{ if (ColorThemeUtils?.firstStopColor) return ColorThemeUtils.firstStopColor(grad); }catch(_){}
    const m = String(grad||"").match(/(#[0-9a-f]{3,6}|rgba?\([^)]+\))/i);
    return m ? m[1] : "#ffffff";
  }


// ---------- Enrich save headers with our fields ----------
const _makeSavefileInfo = DataManager.makeSavefileInfo;
DataManager.makeSavefileInfo = function(){
  const info = _makeSavefileInfo.call(this);
  try{
    const leader = $gameParty.leader();
    info.langCode    = String($gameVariables.value(200) || "");
    info.learnLevel  = Number($gameVariables.value(170) || 0) | 0;
    info.leaderLevel = leader ? leader.level : 0;
    info.gold        = $gameParty.gold();
    info.leaderName  = leader ? leader.name() : "";   // ← NEW
  }catch(_){}
  return info;
};


  // ---------- Visu helpers ----------
  const vsAutoSlotId = () => { try{ const x=window.VisuMZ?.SaveCore?.autoSaveSlotId; if (typeof x==="number") return x; }catch(_){ } return 0; };
  const vsMaxSlots   = () => { try{ return DataManager.maxSavefiles(); }catch(_){ return 20; } };
// Alternate autosave slot id (kept far from manual range 1..max)
  const ALT_AUTO_ID = 98;
  const QUICK_SAVE_ID = 97;

  // Resolve plugin name and register a command to trigger the alternate autosave
  const PLUGIN_NAME = (() => {
    try {
      // Prefer the file name if available, fallback to a known name
      const m = (document.currentScript?.src || "").match(/([^/\\]+)\.js$/i);
      return (m && m[1]) || "SaveLoadHTML";
    } catch (_) { return "SaveLoadHTML"; }
  })();
// Force the extra autosave slot (Autosave B)
async function altAutosaveNow(){
  try{
    // Don’t autosave while we’re in the middle of loading
    if ($gameTemp && $gameTemp._wl_loadingFromSave) return;

    // Respect engine + VisuStella guards
    try{
      if (DataManager?.isSaveEnabled && !DataManager.isSaveEnabled()) return;
    }catch(_){}

    try{
      if (window.VisuMZ?.SaveCore?.canSave && !VisuMZ.SaveCore.canSave()) return;
    }catch(_){}

    // Run your real save pipeline (silent = no save SE)
    pushSilentSaveScene(ALT_AUTO_ID, /*silent=*/true);
  }catch(e){
    console.warn("[SaveLoadHTML] AltAutosaveNow failed:", e);
  }
}

  PluginManager.registerCommand(PLUGIN_NAME, "AltAutosaveNow", async _args => {
    await altAutosaveNow();
  });




// ---------- Auto-save to Autosave B (slot 98) *after* transfers ----------

// Try to autosave after transfer, once the new map is loaded. This is called
// synchronously from Scene_Map.start so the destination map cannot render
// before the black save scene takes over.
function __wl_tryAutosaveAfterTransfer(reason = ""){
  // Skip if we’re in a load pipeline
  if ($gameTemp && $gameTemp._wl_loadingFromSave) return;

  // Must be on Scene_Map
  const scn = SceneManager._scene;
  if (!(scn instanceof Scene_Map)) return;

  // Must be a pending post-transfer autosave request
  if (!$gameTemp || !$gameTemp._wl_postTransferAutosavePending) return;

  // Must NOT still be transferring (we want "after")
  if ($gamePlayer?.isTransferring?.() && $gamePlayer.isTransferring()) return;



  // Respect VS Save Core
  try {
    if (window.VisuMZ?.SaveCore?.canSave && !VisuMZ.SaveCore.canSave()) return;
  } catch(_) {}

  // Consume the pending flag (important: only once)
  $gameTemp._wl_postTransferAutosavePending = false;

  // Scene_Map.start() normally starts the transfer fade-in. SceneManager will
  // not switch scenes while that fade is busy, so cover the map immediately
  // and finish that redundant fade. The cover is destroyed with this scene
  // after the black save scene takes over.
  const bmp = new Bitmap(Graphics.width, Graphics.height);
  bmp.fillAll("black");
  const cover = new Sprite(bmp);
  scn.addChild(cover);

  const previousFadeDuration = scn._fadeDuration;
  scn._fadeDuration = 0;

  try {
    pushSilentSaveScene(ALT_AUTO_ID, /*silent=*/true);
  } catch(e) {
    scn._fadeDuration = previousFadeDuration;
    scn.removeChild(cover);
    cover.destroy?.({ children: true, texture: true, baseTexture: true });
    $gameTemp._wl_postTransferAutosavePending = true;
    console.warn("[SaveLoadHTML] post-transfer autosave failed:", reason, e);
  }
}

// 1) Flag transfers when they REALLY happen
(() => {
  const _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
  Game_Player.prototype.performTransfer = function(){
    const wasTransferring = this.isTransferring?.() && this.isTransferring();

    _Game_Player_performTransfer.call(this);

    // If we actually performed a transfer, request an autosave on the next map load
    if (wasTransferring && $gameTemp){
      $gameTemp._wl_postTransferAutosavePending = true;
    }
  };
})();

// 2) Run autosave once the new map is loaded and stable
(() => {
  const _Scene_Map_onMapLoaded_WL = Scene_Map.prototype.onMapLoaded;
  Scene_Map.prototype.onMapLoaded = function(){
    _Scene_Map_onMapLoaded_WL.call(this);

    // ✅ RESTORE AUDIO AFTER LOADING A SAVE (this is the reliable place)
    try{
      if ($gameTemp && $gameTemp._wl_restoreAudioAfterLoad){
        $gameTemp._wl_restoreAudioAfterLoad = false;

        // Delay 2 frames so Scene_Load is fully gone and Scene_Map is active
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            try{
              const bgm = $gameSystem?.bgm?.();
              const bgs = $gameSystem?.bgs?.();

              // Prefer savefile BGM/BGS
              if (bgm && bgm.name) AudioManager.playBgm(bgm);
              if (bgs && bgs.name) AudioManager.playBgs(bgs);

              // Fallback if nothing is stored
              if ((!bgm || !bgm.name) && (!bgs || !bgs.name)){
                $gameMap?.autoplay?.();
              }
            }catch(_){
              try{ $gameMap?.autoplay?.(); }catch(__){}
            }
          });
        });
      }
    }catch(_){}

    // Always clear the "loading from save" guard after load
    if ($gameTemp) $gameTemp._wl_loadingFromSave = false;

    // ✅ FIX: if Title BGM is still playing, force Map autoplay BGM + BGS now
    try{
      const titleName = $dataSystem?.titleBgm?.name;
      const curName   = AudioManager._currentBgm?.name;

      if (titleName && curName === titleName){
        AudioManager.stopBgm();
        AudioManager.stopBgs();
        $gameMap?.autoplay?.();
      }
    }catch(_){}

    // If a transfer just happened, enforce the destination map's audio now.
    // The autosave itself starts synchronously in Scene_Map.start below, after
    // the engine has cleared its scene stack but before the map can render.
    if ($gameTemp && $gameTemp._wl_postTransferAutosavePending){
      // --- FIX: Force audio autoplay explicitly here ---
      // This ensures that even if the transfer audio logic was skipped or overwritten,
      // the new map's BGM/BGS is enforced once loading is complete.
      if ($gameMap && typeof $gameMap.autoplay === 'function') {
         $gameMap.autoplay();
      }
      // ------------------------------------------------

    }
  };
})();

// ✅ EXTRA SAFETY: also fix audio on Scene_Map.start (covers New Game + edge cases)
(() => {
  const _Scene_Map_start_WL = Scene_Map.prototype.start;
  Scene_Map.prototype.start = function(){
    _Scene_Map_start_WL.call(this);

    // ✅ FIX: if Title BGM is still playing, force Map autoplay BGM + BGS now
    try{
      const titleName = $dataSystem?.titleBgm?.name;
      const curName   = AudioManager._currentBgm?.name;

      if (titleName && curName === titleName){
        AudioManager.stopBgm();
        AudioManager.stopBgs();
        $gameMap?.autoplay?.();
      }
    }catch(_){}

    // ✅ Keep screen black briefly after loading a save (hide collision map flash)
    try{
      const ms = $gameTemp?._wl_holdBlackAfterLoadMs || 0;
      if (ms > 0){
        $gameTemp._wl_holdBlackAfterLoadMs = 0;

        const bmp = new Bitmap(Graphics.width, Graphics.height);
        bmp.fillAll("black");

        const overlay = new Sprite(bmp);
        overlay.opacity = 255;
        overlay.z = 999999;

        this.addChild(overlay);
        this._wl_blackOverlay = overlay;

        // Hold black for ms, then fade out smoothly
        setTimeout(() => {
          const fadeFrames = 15; // ~250ms fade
          let f = fadeFrames;

          const step = () => {
            if (!this._wl_blackOverlay) return;
            f--;
            this._wl_blackOverlay.opacity = Math.max(0, Math.round(255 * (f / fadeFrames)));

            if (f <= 0){
              this.removeChild(this._wl_blackOverlay);
              this._wl_blackOverlay.destroy?.();
              this._wl_blackOverlay = null;
            } else {
              requestAnimationFrame(step);
            }
          };

          requestAnimationFrame(step);
        }, ms);
      }
    }catch(_){}

    // Scene_Map.start() has now called SceneManager.clearStack(), so it is safe
    // to push the save scene. Doing this before start() returns prevents the
    // destination map -> black -> destination map flash on fast transfers.
    if ($gameTemp && $gameTemp._wl_postTransferAutosavePending){
      __wl_tryAutosaveAfterTransfer("Scene_Map.start(after transfer)");
    }
  };
})();

// ✅ NEW GAME: Hold black screen longer (e.g. 2400ms)
(() => {
  const _DataManager_setupNewGame = DataManager.setupNewGame;
  DataManager.setupNewGame = function() {
    _DataManager_setupNewGame.call(this);
    if ($gameTemp) {
      // Set the duration in milliseconds. 
      // Load is usually 1200ms, so 2400ms is twice as long.
      $gameTemp._wl_holdBlackAfterLoadMs = 2400; 
    }
  };
})();


// Safety: if autosave fires very early on Scene_Map, _messageWindow may not exist yet.
(() => {
  const _isMessageWindowClosing = Scene_Map.prototype.isMessageWindowClosing;
  Scene_Map.prototype.isMessageWindowClosing = function(){
    const w = this._messageWindow;
    if (!w || typeof w.isClosing !== "function") return false;
    return _isMessageWindowClosing.call(this);
  };
})();




  // ---------- Engine path ----------
async function engineSlotExists(id){
  try{
    const v = StorageManager.savefileExists(id);
    return (v && typeof v.then === "function") ? !!(await v) : !!v;
  }catch(_){
    return false;
  }
}

  async function engineLoadInfo(id){
    try{
      const v = DataManager.loadSavefileInfo(id);
      return (v && typeof v.then==="function") ? await v : (v || null);
    }catch(_){ return null; }
  }

  // ---------- NW.js filesystem probe ----------
  function fsDir(){ try{ return require("path").normalize(StorageManager.fileDirectoryPath()); }catch(_){ return null; } }
  function fsExistsSlot(id){
    try{
      const path = require("path");
      const fs = require("fs");
      const dir = fsDir(); if (!dir) return false;
      // Respect VS Save Core formats
      const name = `file${id}.rmmzsave`;
      return fs.existsSync(path.join(dir, name));
    }catch(_){ return false; }
  }

  // ---------- Web LocalMode fallback ----------
  function listLocalKeys(prefix){ if (typeof localStorage==="undefined") return []; const a=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if (k && k.startsWith(prefix+".")) a.push(k); } return a; }
  function parseMaybeJSONorLZ(raw){
    if (!raw) return null;
    try{ return JSON.parse(raw); }catch(_){}
    try{ if (window.LZString){ const s=LZString.decompressFromBase64(raw); if (s) return JSON.parse(s); } }catch(_){}
    return null;
  }
  function localHeaderForId(id){
    const keys = listLocalKeys("rmmzsave");
    const pats = [
      new RegExp(`^rmmzsave\\.file${id}$`,"i"),
      new RegExp(`^rmmzsave\\.file${id}\\.info$`,"i"),
      new RegExp(`^rmmzsave\\.file${id}\\.data$`,"i"),
    ];
    let first = null;
    for (const k of keys){
      if (!pats.some(r=>r.test(k))) continue;
      const obj = parseMaybeJSONorLZ(localStorage.getItem(k));
      if (obj && typeof obj==="object"){
        if (looksLikeHeader(obj)) return obj;
        if (obj.info && looksLikeHeader(obj.info)) return obj.info;
        if (!first) first = obj;
      }
    }
    return first && extractHeaderBestEffort(first);
  }
  function looksLikeHeader(o){ return !!(o && (o.timestamp || o.playtime || o.characters || o.title || o.leaderLevel!=null || o.gold!=null)); }
  function extractHeaderBestEffort(o){
    if (!o || typeof o!=="object") return null;
    const h={};
    if (o.timestamp) h.timestamp=o.timestamp;
    if (o.playtime)  h.playtime=o.playtime;
    if (o.characters)h.characters=o.characters;
    if (o.langCode)  h.langCode=o.langCode;
    if (o.learnLevel!=null) h.learnLevel=o.learnLevel;
    if (o.leaderLevel!=null)h.leaderLevel=o.leaderLevel;
    if (o.gold!=null)       h.gold=o.gold;
    for (const k of Object.keys(o)){ const v=o[k]; if (looksLikeHeader(v)) return {...h, ...v}; }
    return Object.keys(h).length ? h : null;
  }
  function localSlotExists(id){
    if (typeof localStorage==="undefined") return false;
    const keys = listLocalKeys("rmmzsave");
    const re = new RegExp(`^rmmzsave\\.file${id}(\\.|$)`,"i");
    return keys.some(k=>re.test(k));
  }

  // ---------- Global headers fallback ----------
  async function loadGlobalHeaders(){
    // 1) DataManager.loadGlobalInfo
    try{
      const g = DataManager.loadGlobalInfo();
      if (Array.isArray(g) && g.length) return g;
    }catch(_){}
    // 2) StorageManager.loadObject('global')
    try{
      const obj = await StorageManager.loadObject("global");
      if (Array.isArray(obj)) return obj;
      if (obj && typeof obj==="object" && Array.isArray(obj.globalInfo)) return obj.globalInfo;
    }catch(_){}
    return null;
  }

  // ---------- Collect headers resiliently ----------
  async function collectInfosRobust(){
const max   = vsMaxSlots();
    const autoId= vsAutoSlotId();
    const ids   = [autoId, ALT_AUTO_ID, QUICK_SAVE_ID, ...Array.from({length:max},(_,i)=>i+1)];

    const infos = {};
    const present = {};

    // A) Try engine global
const globalArr = await loadGlobalHeaders();
if (globalArr){
  for (const id of ids){
    if (globalArr[id]){
      infos[id] = globalArr[id];
      present[id] = true; // ✅ IMPORTANT: allow loading if we have header
    }
  }
}

    // B) Per-slot engine probe
await Promise.all(ids.map(async id=>{
  if (!infos[id]){
    const exists = await engineSlotExists(id);
    if (exists){
      present[id] = true;
      const h = await engineLoadInfo(id);
      if (h) infos[id] = h;
    }
  } else {
    // if we already have info, it's present
    present[id] = true;
  }
}));


    // C) NW.js filesystem probe (your case)
    if (Utils.isNwjs()){
      for (const id of ids){
        if (!present[id] && fsExistsSlot(id)) present[id] = true;
      }
    }

    // D) Web LocalMode fallback
    if (!Utils.isNwjs()){
      for (const id of ids){
        if (!present[id] && localSlotExists(id)) present[id] = true;
        if (!infos[id]) {
          const h = localHeaderForId(id);
          if (h) infos[id] = h;
        }
      }
    }

    return { infos, present, autoId, max };
  }

  // ---------- Character sprite preview ----------

const singleSheet = name => /^\$/.test(name);
const charURL     = name => "img/characters/" + name + ".png";
const charFrameUrlCache = new Map();

/**
 * Draws the middle frame of the "down" row for the party leader.
 * - For $single sheets: whole sheet is 3x4
 * - For normal sheets: 4 characters (4x2), each char is 3x4 frames
 * We place exactly one frame as a CSS background and size the <div> to that frame.
 */
function setupCharSprite(el, name, index){
  try{
    if (!name){
      el.style.background = "rgba(0,0,0,.2)";
      return;
    }

    const container = el.parentElement;
    const bmp = ImageManager.loadCharacter(name); // uses encryption/decryption pipeline

    bmp.addLoadListener(bitmap => {
      try{
        const img = bitmap._image || bitmap.canvas || bitmap._canvas;
        if (!img) {
          el.style.background = "rgba(0,0,0,.2)";
          return;
        }

        const isSingle  = singleSheet(name);
        const totalCols = isSingle ? 3  : 12; // 4 chars * 3 cols
        const totalRows = isSingle ? 4  : 8;  // 2 chars * 4 rows
        const cw = Math.floor(bitmap.width  / totalCols);
        const ch = Math.floor(bitmap.height / totalRows);

        // Which 3x4 block to use (only used for normal sheets)
        let blockX = 0, blockY = 0;
        if (!isSingle){
          const i = Number(index || 0) | 0; // 0..7
          blockX = (i % 4) * 3;             // 0,3,6,9
          blockY = Math.floor(i / 4) * 4;   // 0 or 4
        }

        // We want down row (row 0) and middle frame (col 1)
        const frameCol = 1;
        const frameRow = 0;

        const sx = (blockX + frameCol) * cw;
        const sy = (blockY + frameRow) * ch;

        const maxH = container?.clientHeight || 120;
        const scale = maxH / ch;
        const w = Math.round(cw * scale);
        const h = Math.round(ch * scale);

        const cacheKey = `${name}|${Number(index || 0) | 0}|${bitmap.width}x${bitmap.height}|${sx},${sy},${cw},${ch}`;
        let url = charFrameUrlCache.get(cacheKey);
        if (!url) {
          // Draw just that frame to a tiny canvas once per unique character frame.
          const canvas = document.createElement("canvas");
          canvas.width  = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          if (!ctx){
            el.style.background = "rgba(0,0,0,.2)";
            return;
          }
          ctx.imageSmoothingEnabled = false;

          const src = img instanceof HTMLImageElement ? img : (bitmap.canvas || bitmap._canvas || img);
          ctx.drawImage(src, sx, sy, cw, ch, 0, 0, cw, ch);
          url = canvas.toDataURL("image/png");
          charFrameUrlCache.set(cacheKey, url);
        }

        el.style.width  = w + "px";
        el.style.height = h + "px";
        el.style.backgroundImage    = `url("${url}")`;
        el.style.backgroundRepeat   = "no-repeat";
        el.style.backgroundSize     = `${w}px ${h}px`;
        el.style.backgroundPosition = "center center";
        el.style.imageRendering     = "pixelated";

        if (container){
          container.style.display = "flex";
          container.style.alignItems = "center";
          container.style.justifyContent = "center";
          container.style.overflow = "hidden";
        }
      }catch(e){
        console.warn("[SaveLoadHTML] setupCharSprite inner error", e);
        el.style.background = "rgba(0,0,0,.2)";
      }
    });
  } catch(e){
    console.warn("[SaveLoadHTML] setupCharSprite error", e);
    el.style.background = "rgba(0,0,0,.2)";
  }
}


// Push a black Scene_Save that executes the full save pipeline and auto-closes.
// silent=true disables the save SE (for autosaves).
function pushSilentSaveScene(slot, silent, closeHtmlCb){
  const prev = SceneManager._scene;
  const prevIsHtml = !!prev && prev.constructor && prev.constructor.name === "Scene_SaveLoadHTML";

  class BlackoutQuickSave2 extends Scene_Save {
    create(){
      Scene_Base.prototype.create.call(this);
      const bmp = new Bitmap(Graphics.width, Graphics.height);
      bmp.fillAll("black");
      this.addChild(new Sprite(bmp));
    }
    start(){
      Scene_Base.prototype.start.call(this);
      this.startFadeOut?.(0, false);
      this.executeSave(slot); // runs VS Save Core hooks
    }
    startFadeIn(){ /* keep black */ }
onSaveSuccess(){
  try { if (!silent) SoundManager.playSave?.(); } catch(_){}

  // ✅ DO NOT fade out audio here (fadeOutAll kills BGM/BGS)
  // Just close the scene immediately.
  SceneManager.pop();
  if (prevIsHtml) SceneManager.pop();
}

onSaveFailure(){
  try { SoundManager.playBuzzer?.(); } catch(_){}

  // ✅ DO NOT fade out audio here either
  SceneManager.pop();
}

  }

  try { if (typeof closeHtmlCb === "function") closeHtmlCb(); } catch(_){}
  SceneManager.push(BlackoutQuickSave2);
}

  // ---------- Scene ----------
  class Scene_SaveLoadHTML extends Scene_Base {
    create(){ super.create(); this.createBackground(); }
    start(){ super.start(); this.openUI(); }
    stop(){ super.stop(); this.closeUI(); }

    createBackground(){
      this._backgroundSprite = new Sprite();
      this._backgroundSprite.bitmap = SceneManager.backgroundBitmap();
      this.addChild(this._backgroundSprite);
    }

async openUI(){
      if (this._root) return;
      await loadMenuTranslations();

      // --- FIX START: Prevent input bleed ---
      this._inputEnabled = false;
      setTimeout(() => { this._inputEnabled = true; }, 400); 
      // --- FIX END ---

      this._mode = ($gameTemp && $gameTemp._saveLoadMode) || "load";
      if ($gameTemp) $gameTemp._saveLoadMode = null;
      this._theme = computeTheme();

      let root = document.getElementById("saveLoadHTML");
      if (!root){
        root = document.createElement("div");
        root.id = "saveLoadHTML";
        Object.assign(root.style, {
          position:"absolute", left:"50%", top:"50%", transform:"translate(-50%,-50%)",
          width:"97vw", height:"98vh", zIndex: 999999,
          visibility:"hidden", opacity:"0", transition:"opacity .25s ease"
        });
        root.innerHTML = `<style>${this.css()}</style>${this.html()}`;
        document.body.appendChild(root);
      }
      this._root = root;

      // Font
      const fonts = (window.TextManager && TextManager.optionsCoreFonts) || [];
      const idx   = Number(ConfigManager?.textFont ?? 0);
      const famRaw = String(fonts[idx] || "").trim();
      const fam = /^(|default|gamefont)$/i.test(famRaw) ? "NotoSans" : famRaw;
      this.setUIFont(fam);

      // Wire
      this.wire();

      // Render
      await this.refreshInfosAndRender();
      this._navVisible = false;
      this._navIndex = -1;

      // Listeners
      this._keyHandler = this.onKeyDown.bind(this);
      window.addEventListener("keydown", this._keyHandler, { capture:true });
      this._resizeHandler = this.onResize.bind(this);
      window.addEventListener("resize", this._resizeHandler);
      this._cloudRestoreHandler = () => {
        if (this._root) this.refreshInfosAndRender().catch(error => console.warn("[SaveLoadHTML] cloud refresh failed", error));
      };
      window.addEventListener("wl-cloud-profile-restored", this._cloudRestoreHandler);
      this._cloudAccessHandler = () => {
        const button = this.$(".cloud-sync-btn");
        if (button) button.hidden = !window.WLAccountEntitlements?.canSyncCloud?.();
      };
      window.addEventListener("wl-entitlements-updated", this._cloudAccessHandler);
      this._cloudAccessHandler();

      // Reveal
      const fontsReady = (!document.fonts)
        ? Promise.resolve()
        : (document.fonts.check(`16px ${fam}`) && document.fonts.check(`700 16px ${fam}`)) ? Promise.resolve()
          : Promise.race([
              Promise.allSettled([document.fonts.load(`400 16px ${fam}`), document.fonts.load(`700 16px ${fam}`)]),
              new Promise(r=>setTimeout(r,250))
            ]);
      await fontsReady;
      if (this._root){ this._root.style.visibility="visible"; this._root.style.opacity="1"; }
    }

    closeUI(){
      if (this._cloudAccessHandler) { window.removeEventListener("wl-entitlements-updated", this._cloudAccessHandler); this._cloudAccessHandler = null; }
      if (this._cloudRestoreHandler) { window.removeEventListener("wl-cloud-profile-restored", this._cloudRestoreHandler); this._cloudRestoreHandler = null; }
      if (this._keyHandler){ window.removeEventListener("keydown", this._keyHandler, { capture:true }); this._keyHandler=null; }
      if (this._resizeHandler){ window.removeEventListener("resize", this._resizeHandler); this._resizeHandler=null; }
      if (this._root){ this._root.remove(); this._root=null; }
    }
reopenMenu(){
  const mode = this._mode || "load";

  // close DOM now (so we don't duplicate UI)
  try { this.closeUI(); } catch(_) {}

  // tell the next instance which mode to open in
  if ($gameTemp) $gameTemp._saveLoadMode = mode;

  // replace the current scene with a fresh instance
  SceneManager.goto(Scene_SaveLoadHTML);
}

    setUIFont(family){
      if (!this._root) return;
      let fam = String(family||"").trim();
      if (!fam || /^default$/i.test(fam) || /^gamefont$/i.test(fam)) fam = "NotoSans";
      const quoted = "'" + fam.replace(/'/g,"\\'") + "'";
      this._root.style.setProperty("--ui-font", quoted);
      this.$(".sl-menu")?.style.setProperty("font-family", `var(--ui-font,'NotoSans')`, "important");
      try{ document.fonts?.load && document.fonts.load(`16px ${fam}`).catch(()=>{});}catch(_){}
    }

html(){
  const modeTitle = this._mode==="save" ? "Save Game" : "Load Game";
  const guide    = this._mode==="save" ? "Tap a slot to save." : "Tap a slot to load.";

  return `

  <div class="sl-menu">
<div class="topbar">
  <div class="title" data-k="${modeTitle}">${tdb(modeTitle)}</div>

  <div class="mid-actions">
    <button class="cloud-sync-btn mid-btn" type="button" hidden>
      <span data-k="CloudAccount.Action.SyncNow">${tdb("Sync now")}</span>
    </button>
    <button class="import-btn mid-btn" type="button">
      <span data-k="SaveBackup.ImportButton">${tdb("Import")}</span>
    </button>
    <button class="export-btn mid-btn" type="button">
      <span data-k="SaveBackup.ExportButton">${tdb("Export")}</span>
    </button>
  </div>

  <div class="spacer"></div>
  <button class="return-btn">⟵ <span data-k="Return">${tdb("Return")}</span></button>
</div>


    <div class="content">
      <div class="grid-wrap">
        <div class="row autosave-row"></div>
        <div class="row slots-row"></div>
      </div>
      <div class="confirm-bar">
        <div class="hint" data-k="${guide}">${tdb(guide)}</div>
        <button class="dummy-btn" style="visibility:hidden"></button>
      </div>
    </div>

    <div class="sl-modal hidden">
      <div class="sl-modal-box">
        <div class="sl-modal-text"><span class="sl-modal-line" data-k="ConfirmOverwrite">...</span></div>
        <div class="sl-modal-actions">
          <button class="sl-modal-no"><span data-k="Cancel">...</span></button>
          <button class="sl-modal-yes"><span data-k="OK">...</span></button>
        </div>
      </div>
    </div>
  </div>`;
    }

    css(){
      const T=this._theme||{};
      const primaryBg   = T.primaryBg      || "rgba(0,0,0,.94)";
      const secondaryBg = T.secondaryBg    || "rgba(92,21,129,.94)";
      const buttonGrad  = T.buttonGradient || "linear-gradient(135deg,#F1C40F 0%, #ED8936 100%)";
      const textColor   = T.textColor      || "#fff";
      const highlight   = T.highlightColor || firstStopColor(buttonGrad);
      return `
:root{
  --primary-bg:${primaryBg};
  --secondary-bg:${secondaryBg};
  --accent-gradient: linear-gradient(0deg, rgba(0,0,0,.33), ${secondaryBg});
  --text-color:${textColor};
  --highlight:${highlight};
  --button-grad:${buttonGrad};
  --edge-pad: 1vh; --topbar-h: 9vh; --bar-gap: 1.2vh;
  --inner-h: 98vh; --content-h: calc(var(--inner-h) - (2*var(--edge-pad)) - var(--topbar-h) - var(--bar-gap));
  --confirm-h: 14vh; --work-h: calc(var(--content-h) - var(--confirm-h) + 6vh);
  --panel-radius: 0.9375em; --shadow-blur: 2.2vh; --shadow-y: .8vh;
  --pad-m: 1.2vh; --fs-base: 1.05vw; --fs-title: 3vh; --fs-return: 3vh; --fs-hint: 3vh;
}
html,body{ overflow:hidden; }
.cloud-sync-btn[hidden]{display:none!important}
.sl-menu{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:98vw; height:98vh; padding:var(--edge-pad);
  background:linear-gradient(to bottom right, var(--primary-bg), var(--secondary-bg)); border-radius:2vh;
  box-shadow:0 0 var(--shadow-blur) rgba(0,0,0,.5); color:#fff; font-family:var(--ui-font,'NotoSans');
  -webkit-text-stroke:.06vw black!important; font-size:clamp(14px, 1.2vw, 18px); pointer-events:auto; }
.sl-menu, .sl-menu * { font-family: var(--ui-font,'NotoSans') !important; }

.topbar{ position:absolute; left:var(--edge-pad); right:var(--edge-pad); top:var(--edge-pad);
  height:var(--topbar-h); display:flex; align-items:center; gap:1.2vh; background:var(--accent-gradient);
  border-radius:var(--panel-radius); padding:var(--pad-m); box-shadow:0 var(--shadow-y) var(--shadow-blur) rgba(0,0,0,.25);}
.title{ font-weight:900; font-size:var(--fs-title); -webkit-text-stroke:0!important; color:var(--highlight); }
.spacer{ flex:1 1 auto; }
.return-btn{ background:var(--button-grad); color:#fff; border:none; border-radius:0.6em; padding:0 1.05em; font-weight:900;
  cursor:pointer; -webkit-text-stroke:0!important; font-size:var(--fs-return); box-shadow:0 .8vh 1.6vh rgba(0,0,0,.25);
  transition:transform .12s, filter .12s, box-shadow .12s; translate: 0vh -0.2vh; height: 100%; display: flex; align-items: center; justify-content: center; }
.return-btn:hover,.return-btn:focus-visible{ transform:translateY(-.3vh); filter:brightness(1.15) saturate(1.1); box-shadow:0 1.2vh 2.4vh rgba(0,0,0,.3); outline:none; }
.mid-actions {
  position: absolute;
  left: 33%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 3.5vw;
}
.mid-btn{
  background:var(--button-grad);
  color:#fff;
  border:none;
  border-radius:1vh;
  padding:1.2vh 1vw;
  font-weight:900;
  cursor:pointer;
  touch-action: manipulation;

  -webkit-text-stroke:0!important;
  font-size:calc(var(--fs-return) * 0.85);

  box-shadow:0 .8vh 1.6vh rgba(0,0,0,.25);
  transition:transform .12s, filter .12s, box-shadow .12s;
}
.mid-btn:hover,.mid-btn:focus-visible{
  transform:translateY(-.3vh);
  filter:brightness(1.15) saturate(1.1);
  box-shadow:0 1.2vh 2.4vh rgba(0,0,0,.3);
  outline:none;
}

.content{ position:absolute; left:var(--edge-pad); right:var(--edge-pad);
  top:calc(var(--edge-pad) + var(--topbar-h) + var(--bar-gap)); bottom:var(--edge-pad);
  display:flex; flex-direction:column; gap:1.2vh; }

.grid-wrap{ height:var(--work-h); background:var(--accent-gradient); border-radius:var(--panel-radius); padding:var(--pad-m);
  min-height:0; box-shadow:0 var(--shadow-y) var(--shadow-blur) rgba(0,0,0,.18); overflow:auto;
  scrollbar-width:thin; scrollbar-color:var(--highlight) rgba(255,255,255,.10); touch-action: pan-y; }
.grid-wrap::-webkit-scrollbar{ width:12px; height:12px; }
.grid-wrap::-webkit-scrollbar-track{ background:rgba(255,255,255,.10); border-radius:10px; }
.grid-wrap::-webkit-scrollbar-thumb{ border-radius:10px; border:2px solid rgba(0,0,0,.25);
  background:var(--button-grad, linear-gradient(135deg,#F1C40F 0%, #ED8936 100%)); }
.grid-wrap::-webkit-scrollbar-thumb:hover{ filter:brightness(1.08); }

.row{ display:block; }
.autosave-row{ display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:1.1vw 1.1vw; margin-bottom:1.2vh; }

.slots-row{ display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:1.1vw 1.1vw; }

.slot-card{ display:flex; align-items:center; gap:1.0vw; background:rgb(22 3 30 / 55%); color:#fff; -webkit-text-stroke:0!important;
  border-radius:1.6vh; padding:1.6vh 1.2vw; min-height:17.5vh; border:.6vh solid #ffffff;
  box-shadow:0 .8vh 1.6vh rgba(0,0,0,.2); transition:transform .12s, background .2s, box-shadow .12s;
  cursor:pointer; user-select:none; touch-action: manipulation; }
.slot-card:hover{ background:rgba(197,143,181,.55); transform:translateY(-.3vh); }
.slot-card.disabled{ opacity:.5; pointer-events:none; }

.card-left{
  width:14.5vh; min-width:14.5vh; height:14.5vh;
  border-radius:1vh; background:rgba(0,0,0,.35);
  display:flex; align-items:center; justify-content:center;
  overflow:hidden; position:relative;
}
.char-sprite{
  /* width/height set dynamically to exact frame size */
  display:block;
  background-repeat:no-repeat;
  image-rendering:pixelated;
}


.card-right{ flex:1 1 auto; display:flex; flex-direction:column; gap:.75vh; }
.line-title{ font-weight:900; font-size:1.35vw; color:var(--highlight); display:flex; align-items:center; gap:.6vw; }
.line{ font-size:1.05vw; display:flex; flex-wrap:wrap; gap:1.0vw; opacity:.98; }
.tag{ background:rgba(0,0,0,.35); padding:.4vh .7vw; border-radius:.9vh; font-weight:800; }
.tag.new {
  background: var(--button-grad, linear-gradient(135deg,#F1C40F 0%, #ED8936 100%));
  color: white !important;
  -webkit-text-stroke: 0 !important;
  text-shadow: none !important;
  font-weight: 900;
  padding: 1vh 2vw;
}
.empty-note{ opacity:.9; font-style:italic; }

.sl-menu .sl-modal{ position:absolute; inset:0; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; }
.sl-menu .sl-modal.hidden{ display:none; }
.sl-menu .sl-modal-box{ width:60vw; max-width:48rem; background:var(--primary-bg); border-radius:1.4vh; padding:1.4vh; box-shadow:0 1vh 2.2vh rgba(0,0,0,.45); }
.sl-menu .sl-modal-text{ font-size:calc(1.1 * 1.2vw); -webkit-text-stroke:0!important; margin-bottom:1.6vh; line-height:1.4; text-align:center; }
.sl-menu .sl-modal-actions{ display:flex; justify-content:center; align-items:center; gap:2vw; }
.sl-menu .sl-modal-actions button{ background:var(--button-grad); color:#fff; border:none; border-radius:1.6vh; padding:2.0vh 3vw; font-weight:1000;
  -webkit-text-stroke:0!important; font-size:calc(1.0vw * 1.4); box-shadow:0 .8vh 1.6vh rgba(0,0,0,.25); touch-action: manipulation;
  transition:transform .12s, filter .12s, box-shadow .12s; }
.sl-menu .sl-modal-actions button:hover,.sl-menu .sl-modal-actions button:focus-visible{ transform:translateY(-.3vh); filter:brightness(1.15) saturate(1.1); box-shadow:0 1.2vh 2.4vh rgba(0,0,0,.3); outline:none; }
/* Mobile polish */
.slot-card,
.return-btn,
.mid-btn,
.sl-menu .sl-modal-actions button {
  -webkit-tap-highlight-color: transparent;
}


/* Remove outline on explanations only */
.hint,
.empty-note,
.sl-menu .sl-modal-text {
  -webkit-text-stroke: 0 !important;
  text-shadow: none !important; font-size: 3vh;
}
/* --------------------------------------------------------------------------
   Sleek visual polish layer, matched to CustomMenuUI style.
   Visual-only: keeps layout, save/load logic, slots, and theme palette intact.
   -------------------------------------------------------------------------- */
html,body{
  text-rendering:geometricPrecision;
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
}
.sl-menu{
  border:1px solid rgba(255,255,255,.08);
  box-shadow:
    0 2.4vmin 5.5vmin rgba(0,0,0,.48),
    0 0 4vmin rgba(0,0,0,.36),
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 -1px 0 rgba(0,0,0,.28);
  -webkit-text-stroke:0 !important;
  text-shadow:0 1px 2px rgba(0,0,0,.38);
  isolation:isolate;
}
.sl-menu::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  border-radius:inherit;
  box-shadow:
    inset 0 0 8vmin rgba(255,255,255,.025),
    inset 0 0 12vmin rgba(0,0,0,.22);
  z-index:-1;
}
.sl-menu, .sl-menu *{
  box-sizing:border-box;
  -webkit-text-stroke:0 !important;
}
.topbar,
.grid-wrap,
.confirm-bar,
.sl-modal-box{
  border:1px solid rgba(255,255,255,.16);
  box-shadow:
    0 .55em 1.25em rgba(0,0,0,.24),
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 -1px 0 rgba(0,0,0,.24);
  backdrop-filter:blur(2px);
  -webkit-backdrop-filter:blur(2px);
  position:relative;
}
.topbar::before,
.grid-wrap::before,
.confirm-bar::before,
.sl-modal-box::before{
  content:"";
  position:absolute;
  inset:0;
  border-radius:inherit;
  pointer-events:none;
  background:linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,0) 42%);
}
.topbar > *,
.grid-wrap > *,
.confirm-bar > *,
.sl-modal-box > *{
  position:relative;
  z-index:1;
}
.title{
  letter-spacing:.01em;
  text-shadow:0 1px 2px rgba(0,0,0,.42), 0 0 .7em rgba(255,255,255,.04);
}
.return-btn{
  border:1px solid rgba(255,255,255,.15);
  border-radius:.8em;
  height:100%;
  min-width:20vw;
  padding:0 1.05em;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:.35em;
  translate:none;
  box-shadow:
    0 .45em 1em rgba(0,0,0,.30),
    inset 0 1px 0 rgba(255,255,255,.20),
    inset 0 -1px 0 rgba(0,0,0,.18);
  text-shadow:0 1px 2px rgba(0,0,0,.38);
  transition:filter .2s ease, box-shadow .2s ease, transform .2s ease;
}
.return-btn:hover,
.return-btn:focus-visible{
  filter:brightness(1.08);
  transform:translateY(-.08em);
  box-shadow:
    0 .6em 1.25em rgba(0,0,0,.36),
    inset 0 1px 0 rgba(255,255,255,.24),
    inset 0 -1px 0 rgba(0,0,0,.20);
  outline:none;
}
.mid-btn{
  border:1px solid rgba(255,255,255,.15);
  border-radius:.8em;
  box-shadow:
    0 .45em 1em rgba(0,0,0,.30),
    inset 0 1px 0 rgba(255,255,255,.20),
    inset 0 -1px 0 rgba(0,0,0,.18);
  text-shadow:0 1px 2px rgba(0,0,0,.38);
  transition:filter .2s ease, box-shadow .2s ease, transform .2s ease;
}
.mid-btn:hover,
.mid-btn:focus-visible{
  filter:brightness(1.08);
  transform:translateY(-.08em);
  box-shadow:
    0 .6em 1.25em rgba(0,0,0,.36),
    inset 0 1px 0 rgba(255,255,255,.24),
    inset 0 -1px 0 rgba(0,0,0,.20);
}
.slot-card{
  border:1px solid rgba(255,255,255,.16);
  border-radius:1.25em;
  box-shadow:
    0 .55em 1.25em rgba(0,0,0,.24),
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 -1px 0 rgba(0,0,0,.24);
  position:relative;
  overflow:hidden;
  transition:transform .2s ease, filter .2s ease, background .2s ease, border-color .2s ease, box-shadow .2s ease;
}
.slot-card::before{
  content:"";
  position:absolute;
  inset:0;
  pointer-events:none;
  background:linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,0) 42%);
}
.slot-card > *{
  position:relative;
  z-index:1;
}
.slot-card:hover{
  filter:brightness(1.07);
  border-color:rgba(255,255,255,.22);
  box-shadow:
    0 .75em 1.45em rgba(0,0,0,.30),
    inset 0 1px 0 rgba(255,255,255,.10),
    inset 0 -1px 0 rgba(0,0,0,.24);
}
.slot-card.disabled{
  filter:saturate(.85);
}
.card-left{
  border:1px solid rgba(255,255,255,.12);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    inset 0 .2em .7em rgba(0,0,0,.25),
    0 .25em .65em rgba(0,0,0,.20);
}
.char-sprite{
  filter:drop-shadow(0 .22em .35em rgba(0,0,0,.35));
}
.line-title{
  text-shadow:0 1px 2px rgba(0,0,0,.42), 0 0 .7em rgba(255,255,255,.04);
  letter-spacing:.01em;
}
.line{
  text-shadow:0 1px 2px rgba(0,0,0,.30);
}
.tag{
  border:1px solid rgba(255,255,255,.10);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.08),
    0 .18em .45em rgba(0,0,0,.18);
}
.tag.new{
  border:1px solid rgba(255,255,255,.18);
  box-shadow:
    0 .25em .65em rgba(0,0,0,.24),
    inset 0 1px 0 rgba(255,255,255,.20),
    inset 0 -1px 0 rgba(0,0,0,.16);
  text-shadow:0 1px 2px rgba(0,0,0,.38) !important;
}
.hint,
.empty-note,
.sl-menu .sl-modal-text{
  text-shadow:0 1px 2px rgba(0,0,0,.32) !important;
}
.sl-menu .sl-modal{
  background:rgba(0,0,0,.58);
  backdrop-filter:blur(2px);
  -webkit-backdrop-filter:blur(2px);
}
.sl-menu .sl-modal-box{
  border-radius:1.2em;
}
.sl-menu .sl-modal-actions button{
  border:1px solid rgba(255,255,255,.15);
  border-radius:.8em;
  box-shadow:
    0 .45em 1em rgba(0,0,0,.30),
    inset 0 1px 0 rgba(255,255,255,.20),
    inset 0 -1px 0 rgba(0,0,0,.18);
  text-shadow:0 1px 2px rgba(0,0,0,.38);
  transition:filter .2s ease, box-shadow .2s ease, transform .2s ease;
}
.sl-menu .sl-modal-actions button:hover,
.sl-menu .sl-modal-actions button:focus-visible{
  filter:brightness(1.08);
  transform:translateY(-.08em);
  box-shadow:
    0 .6em 1.25em rgba(0,0,0,.36),
    inset 0 1px 0 rgba(255,255,255,.24),
    inset 0 -1px 0 rgba(0,0,0,.20);
}
.grid-wrap::-webkit-scrollbar-thumb{
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18), 0 0 .5em rgba(0,0,0,.20);
}
.slot-card:focus-visible,
.slot-card.kb-focus,
.return-btn:focus-visible,
.return-btn.kb-focus,
.mid-btn:focus-visible,
.mid-btn.kb-focus,
.sl-menu .sl-modal-actions button:focus-visible{
  outline:none;
  box-shadow:
    0 0 0 3px rgba(255,255,255,.52) inset,
    0 .6em 1.25em rgba(0,0,0,.34),
    inset 0 1px 0 rgba(255,255,255,.18);
}

#saveLoadHTML .return-btn{
  box-sizing:border-box !important;
  width:20vw !important;
  max-width:20vw !important;
  min-width:20vw !important;
  height:5.8vh !important;
  min-height:5.8vh !important;
  padding:0 1.05vw !important;
  display:inline-flex !important;
  align-items:center !important;
  justify-content:center !important;
  gap:.8vw !important;
  border:1px solid rgba(255,255,255,.15) !important;
  border-radius:.8em !important;
  background:var(--button-grad) !important;
  color:#fff !important;
  font-size:3vh !important;
  font-weight:900 !important;
  line-height:1 !important;
  -webkit-text-stroke:0 !important;
  text-shadow:0 1px 2px rgba(0,0,0,.38) !important;
  box-shadow:
    0 .45em 1em rgba(0,0,0,.30),
    inset 0 1px 0 rgba(255,255,255,.20),
    inset 0 -1px 0 rgba(0,0,0,.18) !important;
  transition:filter .2s ease, box-shadow .2s ease, transform .2s ease !important;
}
#saveLoadHTML .return-btn:hover,
#saveLoadHTML .return-btn:focus-visible{
  transform:translateY(-.08em) !important;
  filter:brightness(1.08) !important;
  outline:none !important;
  box-shadow:
    0 .6em 1.25em rgba(0,0,0,.36),
    inset 0 1px 0 rgba(255,255,255,.24),
    inset 0 -1px 0 rgba(0,0,0,.20) !important;
}
#saveLoadHTML .topbar{
  display:grid !important;
  grid-template-columns:minmax(0,1fr) auto 20vw !important;
  align-items:center !important;
  gap:1vw !important;
  overflow:visible !important;
}
#saveLoadHTML .title{
  grid-column:1 !important;
  min-width:0 !important;
  margin:0 !important;
  padding-right:0 !important;
  overflow:hidden !important;
  text-overflow:ellipsis !important;
  white-space:nowrap !important;
}
#saveLoadHTML .spacer{
  display:none !important;
}
#saveLoadHTML .return-btn{
  grid-column:3 !important;
  flex:0 0 20vw !important;
  translate:0 0 !important;
  margin:0 !important;
  align-self:center !important;
}
#saveLoadHTML .mid-actions{
  grid-column:2 !important;
  position:static !important;
  left:auto !important;
  top:auto !important;
  transform:none !important;
  z-index:2 !important;
  
  gap:1vw !important;
}


`;
    }

    $(s){ return this._root ? this._root.querySelector(s) : null; }
    $all(s){ return this._root ? [...this._root.querySelectorAll(s)] : []; }

    wire(){
      const cloudSyncButton = this.$(".cloud-sync-btn");
      const cloud = window.WLAccountEntitlements;
      if (cloud?.bindReleaseTap && cloud?.syncFromUi) {
        cloud.bindReleaseTap(cloudSyncButton, () => cloud.syncFromUi());
      } else cloudSyncButton.hidden = true;
      this.$(".return-btn").addEventListener("pointerup", ()=>{ SoundManager.playCancel?.(); SceneManager.pop(); }, { passive:true });

      this.$(".sl-modal-no").addEventListener("pointerup", ()=>{ SoundManager.playCancel?.(); this.closeModal(); }, { passive:true });
      this.$(".sl-modal-yes").addEventListener("pointerup", ()=>{ SoundManager.playOk?.(); this.confirmOverwriteYes(); }, { passive:true });


      // Import Button
      const importBtn = this.$(".import-btn");
      if (importBtn) {
        importBtn.addEventListener("pointerup", () => {
          try {
            SoundManager.playOk?.();
            const onDone = (ev) => {
              window.removeEventListener("WL_SaveBackup:ImportCancelled", onCancel);
              if (ev && ev.detail && ev.detail.goToTitle) return;
              setTimeout(() => { try { this.reopenMenu(); } catch (_) {} }, 0);
            };
            const onCancel = () => {
              window.removeEventListener("WL_SaveBackup:ImportComplete", onDone);
            };
            window.addEventListener("WL_SaveBackup:ImportComplete", onDone, { once: true });
            window.addEventListener("WL_SaveBackup:ImportCancelled", onCancel, { once: true });

            PluginManager.callCommand(this, "WL_SaveBackup", "ImportBackup", {
              SkipConfirm: "false",
              GoToTitle: "false"
            });
          } catch (e) {
            console.warn("[SaveLoadHTML] import failed:", e);
            SoundManager.playBuzzer?.();
          }
        }, { passive: true });
      }

      // Export Button
      const exportBtn = this.$(".export-btn");
      if (exportBtn) {
        exportBtn.addEventListener("pointerup", () => {
          try {
            SoundManager.playOk?.();
            PluginManager.callCommand(this, "WL_SaveBackup", "ExportBackup", {
              Scope: "all",
              SavefileId: "1",
              IncludeConfigAndGlobal: "true"
            });
          } catch (e) {
            console.warn("[SaveLoadHTML] export failed:", e);
            SoundManager.playBuzzer?.();
          }
        }, { passive: true });
      }

      // Smooth scroll
      const enhanceScroll = (el)=>{
        if (!el || el._scrollEnhanced) return;
        el._scrollEnhanced = true;
        el.style.overscrollBehavior = "contain";
        el.style.webkitOverflowScrolling = "touch";
        el.addEventListener("wheel",(ev)=>{
          const max = el.scrollHeight - el.clientHeight;
          if (max > 0){ el.scrollTop = Math.min(max, Math.max(0, el.scrollTop + ev.deltaY)); ev.preventDefault(); ev.stopPropagation(); }
        },{passive:false});
        let active=false, startY=0, startTop=0;
        el.addEventListener("touchstart",(ev)=>{ if (!ev.touches?.length) return; active=true; startY=ev.touches[0].clientY; startTop=el.scrollTop; },{passive:true});
        el.addEventListener("touchmove",(ev)=>{ if (!active || !ev.touches?.length) return; const dy=ev.touches[0].clientY - startY; el.scrollTop = startTop - dy; ev.preventDefault(); ev.stopPropagation(); },{passive:false});
        const end=()=>active=false; el.addEventListener("touchend",end,{passive:true}); el.addEventListener("touchcancel",end,{passive:true});
      };
      enhanceScroll(this.$(".grid-wrap"));
      enhanceScroll(this.$(".hint"));
    }

    applyLanguage(){ this.$all("[data-k]").forEach(el=>{ el.textContent = tr(el.getAttribute("data-k")); }); }

    async refreshInfosAndRender(){
      this.applyLanguage();
      const { infos, present, autoId, max } = await collectInfosRobust();

      // Find newest slot id by timestamp among autosaves and manual
      const tsVal = (h)=>{
        if (!h || !h.timestamp) return 0;
        const n = Number(h.timestamp);
        if (Number.isFinite(n)) return n;
        const d = new Date(h.timestamp);
        return isNaN(d) ? 0 : d.getTime();
     };
      const allIds = [autoId, ALT_AUTO_ID, QUICK_SAVE_ID, ...Array.from({length:max},(_,i)=>i+1)];
      let newestId = null, newestTs = -1;
      for (const id of allIds){
        const t = tsVal(infos[id]);
        if (t > newestTs){ newestTs = t; newestId = id; }
      }

      // Autosave row: Autosave A, Autosave B, and Quick Save
      const autoHost = this.$(".autosave-row"); autoHost.innerHTML = "";
      const autoFrag = document.createDocumentFragment();
      autoFrag.appendChild(this.buildCard(autoId,     infos[autoId]     || null, true, !!present[autoId],     newestId===autoId));
      autoFrag.appendChild(this.buildCard(ALT_AUTO_ID,infos[ALT_AUTO_ID]|| null, true, !!present[ALT_AUTO_ID], newestId===ALT_AUTO_ID));
      autoFrag.appendChild(this.buildCard(QUICK_SAVE_ID,infos[QUICK_SAVE_ID]|| null, true, !!present[QUICK_SAVE_ID], newestId===QUICK_SAVE_ID));
      autoHost.appendChild(autoFrag);

      // Manual row
      const host = this.$(".slots-row"); host.innerHTML = "";
      const frag = document.createDocumentFragment();
      for (let id=1; id<=max; id++){
        frag.appendChild(this.buildCard(id, infos[id] || null, false, !!present[id], newestId===id));
      }
      host.appendChild(frag);
      this.refreshNavTargets();
    }

    refreshNavTargets(){
      this._navTargets = [
        this.$(".import-btn"),
        this.$(".export-btn"),
        this.$(".return-btn"),
        ...this.$all(".slot-card:not(.disabled)")
      ].filter(Boolean);
      this.applyNavFocus();
    }

    applyNavFocus(){
      const targets = this._navTargets || [];
      targets.forEach((n,i)=> n.classList.toggle("kb-focus", !!this._navVisible && i === this._navIndex));
      const n = targets[this._navIndex];
      if (this._navVisible && n) n.scrollIntoView({ block:"nearest", inline:"nearest" });
    }

    buildCard(id, info, isAuto, isPresent, isNewest){
      const card = document.createElement("div");
      card.className = "slot-card";
      if (this._mode==="save" && isAuto) card.classList.add("disabled");

      const left = document.createElement("div"); left.className="card-left";
      const spr  = document.createElement("div"); spr.className="char-sprite"; left.appendChild(spr);

      const right = document.createElement("div"); right.className="card-right";
      const title = document.createElement("div"); title.className="line-title";

// Title logic + leader name
let baseTitle = "";
if (isAuto && id === vsAutoSlotId()){
  baseTitle = tr("Autosave A") || "Autosave A";
} else if (isAuto && id === ALT_AUTO_ID){
  baseTitle = tr("Autosave B") || "Autosave B";
} else if (isAuto && id === QUICK_SAVE_ID){
  baseTitle = tr("Quick Save") || "Quick Save";
} else {
  const tmpl = tr("Slot %1") || "Slot %1";
  baseTitle = tmpl.replace("%1", String(id));
}

// Pull leader name if present in header (backward-compatible)
const leaderName =
  info && typeof info.leaderName === "string" && info.leaderName.trim()
    ? info.leaderName.trim()
    : "";

// Title = slot name, optionally followed by " - LeaderName"
title.textContent = leaderName ? `${baseTitle} - ${leaderName}` : baseTitle;


      // "New" tag on the newest slot (auto or manual)
      if (isNewest){
        const newTag = document.createElement("span");
        newTag.className = "tag new";
        newTag.textContent = tr("New") || "New";
        title.appendChild(newTag);
      }
      right.appendChild(title);

      if (info){
        const langName = LANG_NATIVE[normLearn(info.langCode)] || String(info.langCode||"");
        const modeName = levelNameFor(info.langCode, info.learnLevel);
        const prettyMode = (modeName==="Very Beginner") ? tr("Very Beginner") : modeName;

        const line1 = document.createElement("div"); line1.className="line";
        const langTag = document.createElement("span"); langTag.className="tag"; langTag.textContent = (tr("Language")||"Language")+": "+(langName||tr("Unknown")||"Unknown");
        const modeTag = document.createElement("span"); modeTag.className="tag"; modeTag.textContent = (tr("Mode")||"Mode")+": "+(prettyMode||tr("Unknown")||"Unknown");
        line1.appendChild(langTag); line1.appendChild(modeTag); right.appendChild(line1);

        const line2 = document.createElement("div"); line2.className="line";
        const lvlTag = document.createElement("span"); lvlTag.className="tag"; lvlTag.textContent = (tr("Level")||"Level")+": "+(info.leaderLevel ?? 0);
        const goldTag = document.createElement("span"); goldTag.className="tag"; goldTag.textContent = (tr("Gold")||"Gold")+": "+(Number(info.gold||0)).toLocaleString();
        line2.appendChild(lvlTag); line2.appendChild(goldTag); right.appendChild(line2);

        const line3 = document.createElement("div"); line3.className="line";
        const tsTag = document.createElement("span"); tsTag.className="tag"; tsTag.textContent = (tr("Saved At")||"Saved At")+": "+this.formatTs(info.timestamp);
        const ptTag = document.createElement("span"); ptTag.className="tag"; ptTag.textContent = (tr("Play Time")||"Play Time")+": "+(info.playtime || "");
        line3.appendChild(tsTag); line3.appendChild(ptTag); right.appendChild(line3);

        const ch = Array.isArray(info.characters) && info.characters.length ? info.characters[0] : null;
        if (ch && ch.length>=2) setupCharSprite(spr, ch[0], ch[1]); else spr.style.background="rgba(0,0,0,.2)";
      } else if (isPresent) {
        // File exists, header missing
        const line = document.createElement("div"); line.className="line";
        const tag  = document.createElement("span"); tag.className="tag";
        tag.textContent = tr("Present") || "Present";
        line.appendChild(tag); right.appendChild(line);
        spr.style.background="rgba(0,0,0,.2)";
      } else {
        const empty = document.createElement("div"); empty.className="empty-note"; empty.textContent = tr("Empty") || "Empty";
        right.appendChild(empty); spr.style.background="rgba(0,0,0,.2)";
      }

      card.appendChild(left); card.appendChild(right);

// --- CORRECTED ACTIVATION LOGIC ---
      let armed = true;
      let startX = 0, startY = 0;
      let isSwiping = false;

      // Track where the touch starts
      card.addEventListener("pointerdown", (e) => {
        startX = e.clientX;
        startY = e.clientY;
        isSwiping = false;
      }, { passive: true });

      // If the touch moves more than 10 pixels, mark it as a swipe
      card.addEventListener("pointermove", (e) => {
        if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
          isSwiping = true;
        }
      }, { passive: true });

      const activate = async (e) => {
        // If they were swiping, ignore the tap!
        if (isSwiping || !this._inputEnabled || !armed) return; 
        armed = false;
        
        try {
          if (this._mode === "save") {
            if (isAuto) { 
              SoundManager.playBuzzer?.(); 
              return; 
            }
            if (isPresent) {
              this.openModalOverwrite(id);
            } else {
              await this.saveToSlot(id);
            }
          } else {
            if (!(isPresent || info)) {
              SoundManager.playBuzzer?.();
              return;
            }
            await this.loadFromSlot(id);
          }
        } finally { 
          // Re-arm after 300ms to prevent accidental double-taps
          setTimeout(() => { armed = true; }, 300); 
        }
      };

      // Ensure the card listens for the tap/click
      card.addEventListener("pointerup", activate, { passive: true });
      return card;
    }


    formatTs(ts){ if (!ts) return ""; try{ return new Date(ts).toLocaleString(); }catch(_){ return String(ts); } }

    openModalOverwrite(slotId){
      this._pendingOverwrite = slotId;
      const tmpl = tr("ConfirmOverwrite") || "Overwrite this slot?";
      this.$(".sl-modal-line").textContent = tmpl.replace("{SLOT}", String(slotId));
      this.$(".sl-modal").classList.remove("hidden");
    }
    closeModal(){ this.$(".sl-modal").classList.add("hidden"); this._pendingOverwrite=null; }
    confirmOverwriteYes(){ const id=this._pendingOverwrite; this.closeModal(); if (id!=null) this.saveToSlot(id); }

// inside Scene_SaveLoadHTML
async saveToSlot(id){
  try{
    try{
      if (window.VisuMZ?.SaveCore?.canSave && !VisuMZ.SaveCore.canSave()){
        console.warn("[SaveLoadHTML] VS Save Core canSave() == false");
        SoundManager.playBuzzer?.();
        return;
      }
    }catch(_){}

    // Do not close the UI here; the silent scene will pop us and close the DOM for us
    pushSilentSaveScene(id, /*silent=*/false);
  }catch(e){
    console.error("[SaveLoadHTML] save error", e);
    SoundManager.playBuzzer?.();
  }
}



async loadFromSlot(id){
  try{
    // Respect VisuStella guard if present
   try {
  if (window.VisuMZ?.SaveCore?.canLoad) {
    const vsCanLoad = !!VisuMZ.SaveCore.canLoad(id);

    if (!vsCanLoad) {
      const fileReallyExists =
        await engineSlotExists(id) ||
        (Utils.isNwjs() && fsExistsSlot(id)) ||
        (!Utils.isNwjs() && localSlotExists(id));

      if (!fileReallyExists) {
        console.warn("[SaveLoadHTML] VS Save Core canLoad() == false and no save file exists for", id);
        SoundManager.playBuzzer?.();
        return;
      }

      console.warn("[SaveLoadHTML] VS Save Core canLoad() == false, but save file exists. Trying to load anyway:", id);
    }
  }
} catch (e) {
  console.warn("[SaveLoadHTML] VS Save Core canLoad check failed. Trying to load anyway:", id, e);
}

    // Fade this custom UI to black so nothing flashes during the handoff
    try { this.startFadeOut?.(18, false); } catch(_) {}
    SoundManager.playOk?.();

    const that = this;
    (function(slot){
      class CustomLoadScene extends Scene_Load {
        // Do not create load windows at all
create(){
  // Let the engine (and VisuStella) build the expected windows, including _listWindow
  Scene_Load.prototype.create.call(this);

  // Hide all file UI (we keep objects alive so VS can call activate safely)
  if (this._helpWindow) this._helpWindow.visible = false;
  if (this._listWindow) this._listWindow.visible = false;
  if (this._statusWindow) this._statusWindow.visible = false;
  if (this._windowLayer) this._windowLayer.visible = false;
}
activateListWindow(){
  if (this._listWindow && typeof this._listWindow.activate === "function") {
    this._listWindow.activate();
  }
  // else: do nothing, avoid crashing
}
fadeOutAll(){
  // Do not fade out audio during our silent load
}

        // Force a pure black background
        createBackground(){
          const bmp = new Bitmap(Graphics.width, Graphics.height);
          bmp.fillAll("black");
          this._backgroundSprite = new Sprite(bmp);
          this.addChild(this._backgroundSprite);
        }
// Start right away and execute the real load pipeline
start(){
  // IMPORTANT: let Scene_Load run its real start() logic (plugins hook here)
  Scene_Load.prototype.start.call(this);

  // Remember which slot we want to load
  this._wl_slotId = Number(slot || 0) | 0;

  // ✅ VisuStella compatibility: executeLoad(savefileId)
  // Vanilla MZ ignores the argument, but VS may require it.
  try{
    this.executeLoad(this._wl_slotId);
  }catch(_){
    // fallback (vanilla)
    this.executeLoad();
  }
}


// Force Scene_Load to load the slot we clicked (instead of using the hidden listWindow)
savefileId(){
  return this._wl_slotId;
}

// After a successful load, restore the saved BGM/BGS
// This prevents the Title music from continuing forever.
onLoadSuccess(){
  try { $gameSystem?.onAfterLoad?.(); } catch(_){}

  // Tell Scene_Map.onMapLoaded to restore audio once the map is ready
  if ($gameTemp) {
    $gameTemp._wl_restoreAudioAfterLoad = true;

    // ✅ Keep screen black after load (hide collision map flash)
    $gameTemp._wl_holdBlackAfterLoadMs = 1200; // 1 second
  }

  Scene_Load.prototype.onLoadSuccess.call(this);
}

onLoadFailure(){
  try {
    if ($gameTemp) {
      $gameTemp._wl_loadingFromSave = false;
      $gameTemp._saveLoadMode = "load";
      $gameTemp._wl_restoreAudioAfterLoad = false;
      $gameTemp._wl_holdBlackAfterLoadMs = 0;
    }
  } catch(_) {}

  try { SoundManager.playBuzzer?.(); } catch(_) {}

  try {
    SceneManager.pop();
    setTimeout(() => {
      try { SceneManager.push(Scene_SaveLoadHTML); }
      catch(e) { console.warn("[SaveLoadHTML] Could not reopen load menu after load failure:", e); }
    }, 0);
  } catch(e) {
    console.warn("[SaveLoadHTML] onLoadFailure error:", e);
  }
}




// Prevent any default fade-in trying to reveal hidden UI
startFadeIn(){ /* no-op to keep screen black until the map takes over */ }

      }

      if ($gameTemp) $gameTemp._wl_loadingFromSave = true;
      SceneManager.push(CustomLoadScene);

      // Close our HTML quickly to avoid DOM lingering during scene switch
      try { that.closeUI(); } catch(_) {}
    })(id);

  }catch(e){
    console.error("[SaveLoadHTML] load error", e);
    SoundManager.playBuzzer?.();
  }
}



    update(){
      super.update();
      this.handleMappedNavInput();
      if (Input.isTriggered("cancel") || TouchInput.isCancelled()) SceneManager.pop();
    }

    onKeyDown(e){
      if (document.documentElement.classList.contains("wl-account-ui-open")) return;
      if (!e._mapped) this._lastDomNavAt = Date.now();
      const key = e.key;
      if (key==="Escape"){ e.preventDefault(); e.stopPropagation(); SceneManager.pop(); return; }
      const targets = this._navTargets || [];
      if (!targets.length) return;
      const isNav = ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(key);
      const isActivate = key === "Enter" || key === "Return" || key === " ";
      if (!isNav && !isActivate) return;
      e.preventDefault(); e.stopPropagation();
      this._navVisible = true;
      const cols = 3;
      if (this._navIndex < 0) this._navIndex = Math.min(3, targets.length - 1);
      else if (key === "ArrowRight") this._navIndex = Math.min(targets.length - 1, this._navIndex + 1);
      else if (key === "ArrowLeft") this._navIndex = Math.max(0, this._navIndex - 1);
      else if (key === "ArrowDown") this._navIndex = Math.min(targets.length - 1, this._navIndex + cols);
      else if (key === "ArrowUp") this._navIndex = Math.max(0, this._navIndex - cols);
      else if (isActivate) { targets[this._navIndex]?.click?.(); return; }
      this.applyNavFocus();
    }
    handleMappedNavInput(){
      if (!this._root || !this.onKeyDown) return;
      if (this._lastDomNavAt && Date.now() - this._lastDomNavAt < 80) return;
      let key = "";
      if (Input.isRepeated("down")) key = "ArrowDown";
      else if (Input.isRepeated("up")) key = "ArrowUp";
      else if (Input.isRepeated("left")) key = "ArrowLeft";
      else if (Input.isRepeated("right")) key = "ArrowRight";
      else if (Input.isTriggered("ok")) key = "Enter";
      if (!key) return;
      this.onKeyDown({ key, _mapped:true, preventDefault(){}, stopPropagation(){} });
    }
    onResize(){ /* CSS responsive */ }

    $(s){ return this._root ? this._root.querySelector(s) : null; }
    $all(s){ return this._root ? [...this._root.querySelectorAll(s)] : []; }
  }

  // ---------- Safe load guard for broken/null save files ----------
  // Important: this does NOT pre-check imported saves from the menu.
  // It only rejects a real RPG Maker save object if StorageManager returns null
  // or a non-save object for fileX, so Scene_Load can run onLoadFailure instead
  // of crashing inside DataManager.extractSaveContents(contents.system).
  function WL_SaveLoadHTML_isSaveObjectName(saveName){
    return /^file\d+$/i.test(String(saveName || ""));
  }

  const _WL_SaveLoadHTML_StorageManager_loadObject = StorageManager.loadObject;
  StorageManager.loadObject = function(saveName){
    const result = _WL_SaveLoadHTML_StorageManager_loadObject.call(this, saveName);
    return Promise.resolve(result).then(obj => {
      if (WL_SaveLoadHTML_isSaveObjectName(saveName)) {
        if (!obj || typeof obj !== "object" || !obj.system) {
          console.warn("[SaveLoadHTML] Save slot data is missing or invalid:", saveName, obj);
          return Promise.reject(new Error("[SaveLoadHTML] Invalid or corrupted save file: " + saveName));
        }
      }
      return obj;
    });
  };

// ---------- Hook default Save/Load ----------
  const _push = SceneManager.push;
  SceneManager.push = function(sceneClass){
    if (sceneClass===Scene_Save || sceneClass===Scene_Load){
      if ($gameTemp) $gameTemp._saveLoadMode = (sceneClass===Scene_Save) ? "save" : "load";
      return _push.call(this, Scene_SaveLoadHTML);
    }
    return _push.call(this, sceneClass);
  };
  // ---------- Auto-Run Plugin Commands on Load ----------
  const _DataManager_extractSaveContents = DataManager.extractSaveContents;
  DataManager.extractSaveContents = function(contents) {
    // Safety net. StorageManager.loadObject should already reject broken save files,
    // but this prevents a mysterious "Cannot read properties of null (reading 'system')"
    // if another plugin calls extractSaveContents directly.
    if (!contents || typeof contents !== "object" || !contents.system) {
      console.error("[SaveLoadHTML] Invalid save contents passed to extractSaveContents:", contents);
      throw new Error("[SaveLoadHTML] Invalid or corrupted save file contents.");
    }

    // 1. Let the engine unpack the save file first (this hydrates $gameVariables)
    _DataManager_extractSaveContents.call(this, contents);

    // 2. Run the commands immediately after, before the map/events start
    // Loading the right folder for Ignis
    PluginManager.callCommand(null, "IgnisTextDatabase", "changeFolder", {});

    // Loading the right vosk model
    PluginManager.callCommand(null, "Shora_VoskInterface", "Reload Model", {});
  };

})();

