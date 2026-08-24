/*:
 * @target MZ
 * @plugindesc [v3.2.1] Asset Downloader + account-linked monthly/Polyglot storefront
 * @author Gemini
 *
 * @help
 * What this does:
 * - Asset Downloader: Keeps your original 3-column grid design.
 * - Paywall Store: Uses a brand new, premium layout designed for sales.
 * - Communicates with the Android Bridge (AndroidManager).
 * - Communicates with the iOS Bridge (default WLiOSManager) for StoreKit 2 purchases and free Apple-hosted On-Demand Resources.
 * - Mobile touch responsiveness and visual tap feedback.
 * - Load/New Game language pack validation and auto-routing.
 * - [FIXED] Full restoration of the menu.json translation engine.
 * - [FIXED] Downloader return button now always returns to the title screen.
 * - [FIXED] Real Android downloads no longer fall back to fake/mock completion.
 * - [FIXED] A pack is only shown as installed when Android confirms its files are really available.
 * - [FIXED] Force Android test mode can no longer suppress the native bridge on a real Android device.
 * - [FIXED] iOS only lists explicitly configured iOS ODR packs plus built-in packs. Android behavior remains unchanged.
 * - [FIXED] iOS installed-state refresh is requested on screen render so TestFlight-installed packs remain visible after app restart.
 * - [ADDED] iOS-only ODR pack configuration without changing Android behavior. Products remain the shared paid chapter/full-game SKUs.
 *
 * ============================================================================
 * SCRIPT CALLS (For Conditional Branches)
 * ============================================================================
 * To check if a user has bought a chapter:
 * * this.ownsProduct("unlock_ch1")
 * * To check if they bought the bundle:
 * * this.ownsProduct("unlock_full_game")
 *
 * iOS bridge expected later in Xcode/Swift:
 * window.WLiOSManager.isPackInstalled(assetPackId)
 * window.WLiOSManager.getPackDownloadStatus(assetPackId)
 * window.WLiOSManager.getPackDownloadProgress(assetPackId)
 * window.WLiOSManager.getPackDownloadError(assetPackId)
 * window.WLiOSManager.downloadPack(assetPackId)
 * window.WLiOSManager.cancelPack(assetPackId)
 * window.WLiOSManager.isPurchased(productId)       // productId = paid chapter/full-game SKU from Products
 * window.WLiOSManager.purchase(productId)          // productId = paid chapter/full-game SKU from Products
 * window.WLiOSManager.getPrice(productId)          // productId = paid chapter/full-game SKU from Products
 * window.WLiOSManager.refreshPurchases()
 * window.WLiOSManager.isBillingReady()
 * window.WLiOSManager.getLastPurchaseStatus()
 * window.WLiOSManager.getLastPurchaseMessage()
 * window.WLiOSManager.clearLastPurchaseState()
 * window.WLiOSManager.isOnline()
 * ============================================================================
 *
 * @param ForceAndroidMode
 * @text Force Android Mode (Windows Test)
 * @type boolean
 * @desc Enable this to force the plugin to check local Windows folders and use mock Android data.
 * @default false
 *
 * @param ForceIOSMode
 * @text Force iOS Mode (Windows Test)
 * @type boolean
 * @desc Enable this to force the plugin to use iOS pack/product configuration and mock iOS downloads/purchases.
 * @default false
 *
 * @param Packs
 * @text Asset Packs (Downloader)
 * @type struct<Pack>[]
 * @default []
 *
 * @param Products
 * @text Paywall Products (Store)
 * @type struct<Product>[]
 * @desc Historical products remain restore-only. The storefront adds Mobile Monthly and Polyglot Permanent (wonderlangfull).
 * @default []
 *
 * @param IOSBridgeObject
 * @text iOS Bridge Object Name
 * @type string
 * @desc JavaScript object exposed by Swift. Leave as WLiOSManager unless you change the Swift bridge name.
 * @default WLiOSManager
 *
 * @param IOSBuiltInPacks
 * @text iOS Built-In Packs
 * @type string
 * @desc Comma-separated pack codes already included in the iOS app bundle. Leave empty when every iOS language pack is optional ODR.
 * @default
 *
 * @param IOSPacks
 * @text iOS On-Demand Resource Packs
 * @type struct<IOSPack>[]
 * @desc iOS-only mapping between language code and free Apple-hosted ODR tag ID.
 * @default []
 *
 *
 * @command openDownloader
 * @text Open Downloader UI
 * @desc Opens the HTML UI to download free Android Asset Packs or free iOS ODR packs.
 *
 * @command openPaywall
 * @text Open Paywall UI
 * @desc Opens the Premium Storefront to purchase content.
 * @arg context
 * @type string
 * @text Paywall Context
 * @desc Optional context such as demoEnd, used to show the right introductory message.
 * @default
 *
 * @command promptPaywall
 * @text Open Paywall (Legacy Command)
 * @desc Opens the Premium Storefront directly. Kept for existing map events.
 *
 * @command checkPacksOnLoad
 * @text Check Packs (New/Load)
 * @desc Validates if required language packs are installed before starting.
 * @arg langVar
 * @type variable
 * @text Current Language Variable
 * @desc Variable containing the 2-letter lang code (e.g., FR). Leave at 0 to check if ANY pack is installed.
 * @default 0
 *
 * @command requestAndroidInAppReview
 * @text Request Android In-App Review
 * @desc Android only. Requests Google Play's native review card at an appropriate gameplay milestone.
 * @arg minimumHours
 * @text Minimum Playtime Hours
 * @type number
 * @min 0
 * @decimals 1
 * @default 5
 *
 * @command openAndroidPlayStoreReviewPage
 * @text Open Android Play Store Review Page
 * @desc Android only. Opens this app's Google Play page for an explicit player-selected review action.
 */

/*~struct~Pack:
 * @param code
 * @text Pack Code (e.g., es, fr)
 * @type string
 *
 * @param text
 * @text Display Name (fallback)
 * @type string
 *
 * @param color1
 * @text Border colour top left
 * @type string
 * @default #ffd166
 *
 * @param color2
 * @text Border colour bottom right
 * @type string
 * @default #ef476f
 */

/*~struct~IOSPack:
 * @param code
 * @text Language Code (e.g., es)
 * @type string
 *
 * @param assetPackId
 * @text iOS ODR Tag ID
 * @type string
 * @desc Apple-hosted On-Demand Resource tag. If empty, the language code is used.
 *
 * @param text
 * @text Display Name
 * @type string
 *
 * @param color1
 * @text Border colour top left
 * @type string
 * @default #ffd166
 *
 * @param color2
 * @text Border colour bottom right
 * @type string
 * @default #ef476f
 */

/*~struct~Product:
 * @param sku
 * @text Product ID / SKU (e.g., unlock_ch1)
 * @type string
 *
 * @param isBundle
 * @text Is this the Full Game Bundle?
 * @type boolean
 * @default false
 *
 * @param isSubscription
 * @text Is this the Monthly Subscription?
 * @type boolean
 * @default false
 *
 * @param text
 * @text Display Name
 * @type string
 *
 * @param description
 * @text Sales Description
 * @type string
 *
 * @param fallbackPrice
 * @text Fallback Price Text
 * @type string
 * @default $0.99
 */

(() => {
    "use strict";

    // Dynamically grab the plugin name so commands bind correctly regardless of the filename
    const pluginName = document.currentScript.src.match(/^.*\/(.*).js$/)[1];
    const P = PluginManager.parameters(pluginName);
    
    const FORCE_ANDROID_REQUESTED = String(P["ForceAndroidMode"] || "false").toLowerCase() === "true";
    const REAL_ANDROID_RUNTIME = typeof window !== "undefined" && (
        typeof window.AndroidManager !== "undefined" ||
        /Android/i.test(String(navigator.userAgent || navigator.vendor || ""))
    );
    const REAL_IOS_RUNTIME = typeof window !== "undefined" && (
        typeof window.WLiOSManager !== "undefined" ||
        /iPad|iPhone|iPod/i.test(String(navigator.userAgent || navigator.vendor || "")) ||
        (String(navigator.platform || "") === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1) ||
        !!window.webkit?.messageHandlers
    );
    // Force Android Mode exists only for desktop/browser testing. Never let a
    // stale test setting disable a production Android or iOS bridge.
    const FORCE_ANDROID = FORCE_ANDROID_REQUESTED && !REAL_ANDROID_RUNTIME && !REAL_IOS_RUNTIME;
    if (FORCE_ANDROID_REQUESTED && (REAL_ANDROID_RUNTIME || REAL_IOS_RUNTIME)) {
        console.warn("[WonderLang PAD] Ignoring Force Android Mode on a real mobile runtime.");
    }
    // Force Android wins if both test modes are accidentally enabled.
    const FORCE_IOS = !FORCE_ANDROID && String(P["ForceIOSMode"] || "false").toLowerCase() === "true";

    function parseStructArray(raw, label) {
        try {
            const arr = JSON.parse(raw || "[]");
            return arr.map((entry) => {
                if (typeof entry === "string") return JSON.parse(entry);
                return entry || {};
            });
        } catch (e) {
            console.error(`[WonderLang PAD] Failed to parse plugin parameter "${label}":`, e);
            return [];
        }
    }

    function normalizePackCode(code) {
        return String(code || "").trim().toLowerCase();
    }

    const LANGUAGE_CODES = ["fr", "es", "de", "pt", "it", "kr", "jp", "zh", "en", "us", "ar"];

    const LANGUAGE_NAMES = {
        fr: "French",
        es: "Spanish",
        de: "German",
        pt: "Portuguese",
        it: "Italian",
        kr: "Korean",
        jp: "Japanese",
        zh: "Chinese",
        en: "English",
        us: "American English",
        ar: "Arabic"
    };

    function parseCsvSet(raw, fallback) {
        const source = String(raw == null || raw === "" ? fallback || "" : raw);
        return new Set(source
            .split(/[;,]/)
            .map(normalizePackCode)
            .filter(Boolean));
    }


    function defaultBuiltInPackDefinition(code) {
        const c = normalizePackCode(code);
        return {
            code: c,
            text: LANGUAGE_NAMES[c] || c.toUpperCase(),
            color1: "#28a745",
            color2: "#28a745",
            builtIn: true
        };
    }

    function defaultDownloadablePackDefinition(code) {
        const c = normalizePackCode(code);
        return {
            code: c,
            text: LANGUAGE_NAMES[c] || c.toUpperCase(),
            color1: "#ffd166",
            color2: "#ef476f",
            builtIn: false
        };
    }

    // Android configuration. This preserves the existing Android behavior:
    // no built-in language pack, all language packs are optional PAD packs, and Products are Google Play SKUs.
    const ANDROID_BUILT_IN_PACK_CODES = new Set([]);
    const ANDROID_BLOCKED_PACK_CODES = new Set([]);
    const RAW_PACKS = parseStructArray(P["Packs"], "Packs");
    const RAW_PRODUCTS = parseStructArray(P["Products"], "Products");
    const HISTORICAL_CHAPTER_SKUS = new Set(["wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4"]);
    const POLYGLOT_PRODUCT = {
        ...(RAW_PRODUCTS.find(product => normalizeSkuForPlatformEarly(product?.sku) === "wonderlangfull" || product?.isBundle === true || product?.isBundle === "true") || {}),
        sku: "wonderlangfull",
        isBundle: true,
        isSubscription: false,
        text: "Polyglot Permanent Access",
        description: "Own the full game forever on this mobile platform. Cloud save is not included.",
        fallbackPrice: "$31.99"
    };
    POLYGLOT_PRODUCT.sku = "wonderlangfull";
    POLYGLOT_PRODUCT.isBundle = true;
    POLYGLOT_PRODUCT.isSubscription = false;
    const MONTHLY_PRODUCT = {
        ...(RAW_PRODUCTS.find(product => normalizeSkuForPlatformEarly(product?.sku) === "wonderlangmonthly") || {}),
        sku: "wonderlangmonthly",
        isBundle: false,
        isSubscription: true,
        text: "WonderLang Monthly",
        description: "Every chapter, every language, and cloud saves. Cancel anytime.",
        fallbackPrice: "$6.99"
    };
    MONTHLY_PRODUCT.sku = "wonderlangmonthly";
    MONTHLY_PRODUCT.isBundle = false;
    MONTHLY_PRODUCT.isSubscription = true;
    const RESTORE_PRODUCTS = RAW_PRODUCTS.length ? RAW_PRODUCTS : [
        ...Array.from(HISTORICAL_CHAPTER_SKUS).map((sku, index) => ({ sku, text: `Chapter ${index + 1}` })),
        POLYGLOT_PRODUCT
    ];
    const PRODUCTS = [MONTHLY_PRODUCT, POLYGLOT_PRODUCT];

    function normalizeSkuForPlatformEarly(sku) {
        return String(sku || "").trim().toLowerCase();
    }

    const ANDROID_DOWNLOADABLE_PACKS = [];
    const ANDROID_BUILT_IN_DISPLAY_PACKS = [];
    const androidSeenPackCodes = new Set();

    function rememberAndroidBuiltInDisplayPack(pack) {
        const code = normalizePackCode(pack?.code);
        if (!code || !ANDROID_BUILT_IN_PACK_CODES.has(code)) return;
        if (ANDROID_BUILT_IN_DISPLAY_PACKS.some(p => normalizePackCode(p.code) === code)) return;
        ANDROID_BUILT_IN_DISPLAY_PACKS.push({ ...defaultBuiltInPackDefinition(code), ...pack, code, builtIn: true });
    }

    RAW_PACKS.forEach((pack) => {
        const code = normalizePackCode(pack.code);
        if (!code) return;

        if (ANDROID_BUILT_IN_PACK_CODES.has(code)) {
            rememberAndroidBuiltInDisplayPack({ ...pack, code });
            console.info(`[WonderLang PAD] Pack "${code}" is built in and will be shown as installed.`);
            return;
        }

        if (ANDROID_BLOCKED_PACK_CODES.has(code)) {
            console.error(`[WonderLang PAD] Pack "${code}" is blocked because it does not exist as a PAD module.`);
            return;
        }

        if (androidSeenPackCodes.has(code)) {
            console.warn(`[WonderLang PAD] Duplicate pack "${code}" ignored.`);
            return;
        }

        androidSeenPackCodes.add(code);
        ANDROID_DOWNLOADABLE_PACKS.push({ ...pack, code, builtIn: false });
    });

    LANGUAGE_CODES.forEach((code) => {
        if (!androidSeenPackCodes.has(code) && !ANDROID_BLOCKED_PACK_CODES.has(code)) {
            androidSeenPackCodes.add(code);
            ANDROID_DOWNLOADABLE_PACKS.push(defaultDownloadablePackDefinition(code));
        }
    });

    const ANDROID_PACKS = ANDROID_DOWNLOADABLE_PACKS;
    const ANDROID_DISPLAY_PACKS = [...ANDROID_BUILT_IN_DISPLAY_PACKS, ...ANDROID_PACKS];
    const ANDROID_DOWNLOADABLE_PACK_CODES = new Set(ANDROID_PACKS.map(p => normalizePackCode(p.code)));
    const ANDROID_ALL_KNOWN_PACK_CODES = new Set([...ANDROID_BUILT_IN_PACK_CODES, ...ANDROID_DOWNLOADABLE_PACK_CODES]);

    // iOS configuration. Used only on iOS. PC, Mac, and Android behavior is unchanged.
    const IOS_BRIDGE_OBJECT = String(P["IOSBridgeObject"] || "WLiOSManager").trim() || "WLiOSManager";
    const IOS_BUILT_IN_PACK_CODES = parseCsvSet(P["IOSBuiltInPacks"], "");
    const RAW_IOS_PACKS = parseStructArray(P["IOSPacks"], "IOSPacks");

    const IOS_BUILT_IN_DISPLAY_PACKS = [];
    const IOS_DOWNLOADABLE_PACKS = [];
    const iosSeenPackCodes = new Set();

    function makeIOSPack(rawPack, codeOverride) {
        const code = normalizePackCode(codeOverride || rawPack?.code);
        if (!code) return null;
        const assetPackId = String(rawPack?.assetPackId || code).trim();
        return {
            ...defaultDownloadablePackDefinition(code),
            ...rawPack,
            code,
            assetPackId,
            text: rawPack?.text || LANGUAGE_NAMES[code] || code.toUpperCase(),
            builtIn: IOS_BUILT_IN_PACK_CODES.has(code)
        };
    }

    function findRawIOSPack(code) {
        const c = normalizePackCode(code);
        return RAW_IOS_PACKS.find(p => normalizePackCode(p?.code) === c) || null;
    }

    // iOS intentionally does NOT auto-add every default language.
    // Android keeps the old behavior because all Android language modules exist as PAD packs.
    // iOS only shows:
    // - packs listed in IOSBuiltInPacks
    // - packs explicitly listed in IOSPacks, for example es
    // This prevents iOS from trying to look up Apple-hosted ODR tags that do not exist yet.
    IOS_BUILT_IN_PACK_CODES.forEach((code) => {
        const c = normalizePackCode(code);
        if (!c || iosSeenPackCodes.has(c)) return;
        const configured = findRawIOSPack(c);
        const pack = makeIOSPack(configured || {}, c);
        if (!pack) return;
        iosSeenPackCodes.add(c);
        IOS_BUILT_IN_DISPLAY_PACKS.push({
            ...defaultBuiltInPackDefinition(c),
            ...pack,
            code: c,
            builtIn: true
        });
    });

    RAW_IOS_PACKS.forEach((pack) => {
        const iosPack = makeIOSPack(pack);
        if (!iosPack) return;
        const code = normalizePackCode(iosPack.code);
        if (!code || iosSeenPackCodes.has(code)) return;

        iosSeenPackCodes.add(code);

        if (IOS_BUILT_IN_PACK_CODES.has(code)) {
            IOS_BUILT_IN_DISPLAY_PACKS.push({
                ...defaultBuiltInPackDefinition(code),
                ...iosPack,
                code,
                builtIn: true
            });
        } else {
            IOS_DOWNLOADABLE_PACKS.push({
                ...iosPack,
                code,
                builtIn: false
            });
        }
    });

    const IOS_PACKS = IOS_DOWNLOADABLE_PACKS;
    const IOS_DISPLAY_PACKS = [...IOS_BUILT_IN_DISPLAY_PACKS, ...IOS_PACKS];
    const IOS_DOWNLOADABLE_PACK_CODES = new Set(IOS_PACKS.map(p => normalizePackCode(p.code)));
    const IOS_ALL_KNOWN_PACK_CODES = new Set([...IOS_BUILT_IN_PACK_CODES, ...IOS_DOWNLOADABLE_PACK_CODES]);

    function isIOSRuntime() {
        if (FORCE_ANDROID) return false;
        if (FORCE_IOS) return true;
        if (typeof window !== "undefined" && window[IOS_BRIDGE_OBJECT]) return true;
        const ua = String(navigator.userAgent || navigator.vendor || "");
        const platform = String(navigator.platform || "");
        return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function activeConfig() {
        if (isIOSRuntime()) {
            return {
                platform: "ios",
                builtInPackCodes: IOS_BUILT_IN_PACK_CODES,
                packs: IOS_PACKS,
                displayPacks: IOS_DISPLAY_PACKS,
                downloadablePackCodes: IOS_DOWNLOADABLE_PACK_CODES,
                allKnownPackCodes: IOS_ALL_KNOWN_PACK_CODES
            };
        }

        return {
            platform: "android",
            builtInPackCodes: ANDROID_BUILT_IN_PACK_CODES,
            packs: ANDROID_PACKS,
            displayPacks: ANDROID_DISPLAY_PACKS,
            downloadablePackCodes: ANDROID_DOWNLOADABLE_PACK_CODES,
            allKnownPackCodes: ANDROID_ALL_KNOWN_PACK_CODES
        };
    }

    function activeProducts() {
        // New mobile-store sales are deliberately limited to Monthly and Polyglot Permanent. Historical chapter
        // products remain in RESTORE_PRODUCTS and the native query allowlist only.
        return PRODUCTS;
    }

    function findActivePack(code) {
        const c = normalizePackCode(code);
        return activeConfig().displayPacks.find(p => normalizePackCode(p.code) === c);
    }

    function nativeAssetPackIdForCode(code) {
        const c = normalizePackCode(code);
        if (!isIOSRuntime()) return c;
        const pack = findActivePack(c);
        return String(pack?.assetPackId || c).trim();
    }

    const MOCK_INSTALLED = {};
    const MOCK_PURCHASED = {};
    const MOCK_DOWNLOAD_TIMERS = {};

    // Only packs explicitly started by the player in this JS session should be displayed as "Downloading...".
    // This prevents stale Play Core states, restored queues, or status checks from making every pack look active.
    const USER_STARTED_DOWNLOADS = new Set();

    // iOS state checks are asynchronous: getPackDownloadStatus(assetId) asks Swift to refresh,
    // then WLiOSManager._nativeUpdate(...) updates the cached JS state a moment later.
    // Throttle refresh requests so rendering the downloader grid does not spam Swift every frame.
    const IOS_PACK_REFRESH_LAST_MS = {};

    function requestIOSPackStateRefresh(code) {
        if (!isIOSRuntime()) return;
        const c = normalizePackCode(code);
        if (!c || isBuiltInPackCode(c) || !isDownloadablePackCode(c)) return;

        const now = Date.now();
        if (IOS_PACK_REFRESH_LAST_MS[c] && now - IOS_PACK_REFRESH_LAST_MS[c] < 1500) return;
        IOS_PACK_REFRESH_LAST_MS[c] = now;

        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);
        if (bridge && typeof bridge.getPackDownloadStatus === "function") {
            try { bridge.getPackDownloadStatus(assetId); }
            catch (e) { console.warn("[WonderLang PAD] iOS state refresh failed for " + assetId + ".", e); }
        }
    }

    // ------------- Native Bridge Helpers -------------
    
    // Helper to physically check Windows filesystem during testing
    function checkLocalFolder(code) {
        if (Utils.isNwjs()) {
            try {
                const fs = require('fs');
                const path = require('path');
                const base = path.dirname(process.mainModule.filename);
                
                // Checks root /KR, or /languages/KR
                const dirs = [
                    code.toUpperCase(),
                    code.toLowerCase(),
                    `languages/${code.toUpperCase()}`
                ];
                
                for (const d of dirs) {
                    if (fs.existsSync(path.join(base, d))) return true;
                }
            } catch (e) {
                console.warn("Filesystem check failed:", e);
            }
        }
        return false;
    }

    function hasAndroidManagerBridge() {
        return !FORCE_ANDROID && typeof window.AndroidManager !== "undefined";
    }

    function getIOSManagerBridge() {
        if (FORCE_ANDROID) return null;
        try { return window[IOS_BRIDGE_OBJECT] || null; } catch (_) { return null; }
    }

    function hasIOSManagerBridge() {
        return !!getIOSManagerBridge();
    }

    function hasAndroidDownloadBridge() {
        return hasAndroidManagerBridge() && typeof window.AndroidManager.downloadPack === "function";
    }

    function hasIOSDownloadBridge() {
        const bridge = getIOSManagerBridge();
        return !!bridge && typeof bridge.downloadPack === "function";
    }

    function isProbablyRealAndroidRuntime() {
        const ua = String(navigator.userAgent || navigator.vendor || "");
        return /Android/i.test(ua) || hasAndroidManagerBridge();
    }

    function currentStoreName() {
        return isIOSRuntime() ? "App Store" : "Google Play";
    }

    function currentAssetDeliveryName() {
        return isIOSRuntime() ? "iOS on-demand resource" : "Android asset pack";
    }

    function normalizeNativeStatus(raw) {
        const s = String(raw || "UNKNOWN").toUpperCase();
        if (s === "INSTALLED" || s === "DOWNLOADED" || s === "READY" || s === "AVAILABLE_LOCALLY") return "COMPLETED";
        if (s === "AVAILABLE" || s === "NOT_DOWNLOADED" || s === "DOWNLOAD_REQUIRED") return "NOT_INSTALLED";
        if (s === "INSTALLING") return "TRANSFERRING";
        if (s === "PAUSED") return "PENDING";
        return s;
    }

function isBuiltInPackCode(code) {
    return activeConfig().builtInPackCodes.has(normalizePackCode(code));
}

function isDownloadablePackCode(code) {
    return activeConfig().downloadablePackCodes.has(normalizePackCode(code));
}

function isKnownPackCode(code) {
    return activeConfig().allKnownPackCodes.has(normalizePackCode(code));
}

function packDisplayName(code) {
    const c = normalizePackCode(code);
    const pack = findActivePack(c);

    if (pack && pack.text && String(pack.text).trim()) {
        return tdb(pack.text);
    }

    if (c === "fr") {
        const key = "LangName.FR";
        const got = tr(key, detectBaseLanguageCode());
        if (got && got !== key) return tdb(got);
        return "French";
    }

    return c.toUpperCase();
}

function packDebugSummary(code) {
    const c = normalizePackCode(code);
    const status = getNativePackStatus(c);
    const progress = getNativePackProgress(c);
    const size = getNativePackDownloadSize(c);
    const err = getNativePackError(c);
    const cfg = activeConfig();
    return [
        `Platform: ${cfg.platform}`,
        `Pack: ${c || "EMPTY"}`,
        `Native asset ID: ${nativeAssetPackIdForCode(c) || "EMPTY"}`,
        `Status: ${status}`,
        `Actually installed: ${isPackInstalled(c)}`,
        `Progress: ${progress}%`,
        `Downloaded: ${size ? `${size.downloadedBytes}/${size.totalBytes || "?"} bytes` : "unavailable"}`,
        `Error: ${err}`,
        `Android bridge: ${hasAndroidManagerBridge()}`,
        `iOS bridge (${IOS_BRIDGE_OBJECT}): ${hasIOSManagerBridge()}`,
        `Download bridge: ${isIOSRuntime() ? hasIOSDownloadBridge() : hasAndroidDownloadBridge()}`,
        `Built-in: ${isBuiltInPackCode(c)}`,
        `Downloadable: ${isDownloadablePackCode(c)}`,
        `Allowed downloads: ${Array.from(cfg.downloadablePackCodes).join(", ") || "none"}`,
        `Built-in packs: ${Array.from(cfg.builtInPackCodes).join(", ") || "none"}`
    ].join("<br>");
}

function getNativePackStatus(code) {
    const c = normalizePackCode(code);

    if (!c) return "INVALID";
    if (isBuiltInPackCode(c)) return "COMPLETED";
    if (!isDownloadablePackCode(c)) return "INVALID";

    if (isIOSRuntime()) {
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);

        if (FORCE_IOS && Utils.isNwjs() && checkLocalFolder(c)) {
            return "COMPLETED";
        }

        if (FORCE_IOS && MOCK_INSTALLED[c]) {
            return "COMPLETED";
        }

        if (FORCE_IOS && !bridge) {
            return "NOT_INSTALLED";
        }

        if (bridge) {
            if (typeof bridge.getPackDownloadStatus === "function") {
                try {
                    return normalizeNativeStatus(bridge.getPackDownloadStatus(assetId));
                } catch (e) {
                    console.error(`[WonderLang PAD] iOS getPackDownloadStatus failed for "${assetId}".`, e);
                    return "UNKNOWN";
                }
            }

            if (typeof bridge.isPackInstalled === "function") {
                try {
                    return bridge.isPackInstalled(assetId) ? "COMPLETED" : "NOT_INSTALLED";
                } catch (e) {
                    console.error(`[WonderLang PAD] iOS isPackInstalled status fallback failed for "${assetId}".`, e);
                    return "UNKNOWN";
                }
            }

            return "IOS_BRIDGE_STATUS_MISSING";
        }

        return "IOS_BRIDGE_MISSING";
    }

    if (hasAndroidManagerBridge()) {
        if (typeof window.AndroidManager.getPackDownloadStatus === "function") {
            try {
                return normalizeNativeStatus(window.AndroidManager.getPackDownloadStatus(c));
            } catch (e) {
                console.error(`[WonderLang PAD] getPackDownloadStatus failed for "${c}".`, e);
                return "UNKNOWN";
            }
        }

        if (typeof window.AndroidManager.isPackInstalled === "function") {
            try {
                return window.AndroidManager.isPackInstalled(c) ? "COMPLETED" : "NOT_INSTALLED";
            } catch (e) {
                console.error(`[WonderLang PAD] isPackInstalled status fallback failed for "${c}".`, e);
                return "UNKNOWN";
            }
        }

        return "BRIDGE_STATUS_MISSING";
    }

    if (FORCE_ANDROID && Utils.isNwjs() && checkLocalFolder(c)) {
        return "COMPLETED";
    }

    if (FORCE_ANDROID && MOCK_INSTALLED[c]) {
        return "COMPLETED";
    }

    if (isProbablyRealAndroidRuntime()) {
        return "BRIDGE_MISSING";
    }

    return "NOT_INSTALLED";
}

function getNativePackProgress(code) {
    const c = normalizePackCode(code);

    if (isBuiltInPackCode(c)) return 100;
    if (!isDownloadablePackCode(c)) return 0;

    if (isIOSRuntime()) {
        if (FORCE_IOS && MOCK_INSTALLED[c]) return 100;
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);
        if (bridge && typeof bridge.getPackDownloadProgress === "function") {
            try {
                const value = Number(bridge.getPackDownloadProgress(assetId));
                return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
            } catch (e) {
                console.error(`[WonderLang PAD] iOS getPackDownloadProgress failed for "${assetId}".`, e);
                return 0;
            }
        }
        return 0;
    }

    if (hasAndroidManagerBridge() && typeof window.AndroidManager.getPackDownloadProgress === "function") {
        try {
            const value = Number(window.AndroidManager.getPackDownloadProgress(c));
            return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
        } catch (e) {
            console.error(`[WonderLang PAD] getPackDownloadProgress failed for "${c}".`, e);
            return 0;
        }
    }

    return FORCE_ANDROID && MOCK_INSTALLED[c] ? 100 : 0;
}

function getNativePackDownloadSize(code) {
    const c = normalizePackCode(code);
    if (!c || isBuiltInPackCode(c) || !isDownloadablePackCode(c)) return null;

    const parseSize = (raw) => {
        if (raw == null || raw === "") return null;

        let value = raw;
        if (typeof raw === "string") {
            try { value = JSON.parse(raw); } catch (_) { return null; }
        }
        if (!value || typeof value !== "object") return null;

        const downloadedBytes = Number(
            value.downloadedBytes ??
            value.bytesDownloaded ??
            value.downloaded ??
            0
        );
        const totalBytes = Number(
            value.totalBytes ??
            value.totalBytesToDownload ??
            value.total ??
            0
        );

        if (!Number.isFinite(downloadedBytes) || !Number.isFinite(totalBytes)) return null;
        return {
            downloadedBytes: Math.max(0, downloadedBytes),
            totalBytes: Math.max(0, totalBytes)
        };
    };

    if (isIOSRuntime()) {
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);
        if (bridge && typeof bridge.getPackDownloadSize === "function") {
            try { return parseSize(bridge.getPackDownloadSize(assetId)); } catch (_) { return null; }
        }
        return null;
    }

    if (hasAndroidManagerBridge() && typeof window.AndroidManager.getPackDownloadSize === "function") {
        try { return parseSize(window.AndroidManager.getPackDownloadSize(c)); } catch (_) { return null; }
    }

    return null;
}

function formatDownloadBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "";
    const mb = value / (1024 * 1024);
    return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}

function downloadProgressDetails(code, progress) {
    const size = getNativePackDownloadSize(code);
    if (!size || !(size.totalBytes > 0)) return null;
    return {
        progress: Math.max(0, Math.min(100, Number(progress) || 0)),
        downloaded: formatDownloadBytes(size.downloadedBytes),
        total: formatDownloadBytes(size.totalBytes)
    };
}

function progressBucket(progress) {
    const value = Math.max(0, Math.min(100, Number(progress) || 0));
    if (value >= 100) return "100";
    if (value >= 75) return "75_99";
    if (value >= 50) return "50_74";
    if (value >= 25) return "25_49";
    if (value > 0) return "1_24";
    return "0";
}

function logAnalyticsEvent(name, params = {}) {
    const telemetry = window.WLProgressTelemetry;
    if (telemetry && typeof telemetry.trackAndroidEvent === "function") {
        return telemetry.trackAndroidEvent(name, params);
    }

    // Backward-compatible fallback for builds where the telemetry plugin is disabled.
    if (!hasAndroidManagerBridge() || typeof window.AndroidManager.logAnalyticsEvent !== "function") return false;

    const flatParams = {};
    Object.keys(params || {}).forEach((key) => {
        const value = params[key];
        if (value == null) return;
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            flatParams[key] = value;
        }
    });

    try {
        window.AndroidManager.logAnalyticsEvent(String(name || ""), JSON.stringify(flatParams));
        return true;
    } catch (e) {
        console.warn(`[WonderLang Analytics] Could not log "${name}".`, e);
        return false;
    }
}

function getNativePackError(code) {
    const c = normalizePackCode(code);

    if (!isDownloadablePackCode(c)) return -996;

    if (isIOSRuntime()) {
        if (FORCE_IOS) return 0;
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);
        if (bridge && typeof bridge.getPackDownloadError === "function") {
            try {
                const value = Number(bridge.getPackDownloadError(assetId));
                return Number.isFinite(value) ? value : 0;
            } catch (e) {
                console.error(`[WonderLang PAD] iOS getPackDownloadError failed for "${assetId}".`, e);
                return -994;
            }
        }
        return 0;
    }

    if (hasAndroidManagerBridge() && typeof window.AndroidManager.getPackDownloadError === "function") {
        try {
            const value = Number(window.AndroidManager.getPackDownloadError(c));
            return Number.isFinite(value) ? value : 0;
        } catch (e) {
            console.error(`[WonderLang PAD] getPackDownloadError failed for "${c}".`, e);
            return -995;
        }
    }

    return 0;
}

function requestMobileDataDownload() {
    if (isIOSRuntime()) return false;
    if (hasAndroidManagerBridge() && typeof window.AndroidManager.requestMobileDataDownload === "function") {
        try { return !!window.AndroidManager.requestMobileDataDownload(); } catch (_) { return false; }
    }
    return false;
}

function isPackDownloading(code) {
    if (isBuiltInPackCode(code) || !isDownloadablePackCode(code)) return false;

    const status = getNativePackStatus(code);
    return status === "PENDING" ||
        status === "DOWNLOADING" ||
        status === "TRANSFERRING" ||
        status === "FINALIZING" ||
        status === "WAITING_FOR_WIFI" ||
        status === "REQUIRES_USER_CONFIRMATION";
}

function shouldShowPackDownloading(code) {
    const c = normalizePackCode(code);

    if (isBuiltInPackCode(c) || !isDownloadablePackCode(c)) return false;

    const status = getNativePackStatus(c);

    if (!USER_STARTED_DOWNLOADS.has(c)) {
        if (!isIOSRuntime()) return false;
        return status === "PENDING" ||
            status === "DOWNLOADING" ||
            status === "TRANSFERRING" ||
            status === "FINALIZING";
    }

    if (status === "FAILED" || status === "CANCELED" || status === "NOT_INSTALLED" || status === "INVALID") {
        USER_STARTED_DOWNLOADS.delete(c);
        return false;
    }

    return status === "PENDING" ||
        status === "DOWNLOADING" ||
        status === "TRANSFERRING" ||
        status === "FINALIZING" ||
        status === "WAITING_FOR_WIFI" ||
        status === "REQUIRES_USER_CONFIRMATION";
}

function isPackInstalled(code) {
    const c = normalizePackCode(code);

    if (isBuiltInPackCode(c)) return true;
    if (!isDownloadablePackCode(c)) return false;

    if (isIOSRuntime()) {
        if (FORCE_IOS && Utils.isNwjs() && checkLocalFolder(c)) return true;
        if (FORCE_IOS && MOCK_INSTALLED[c]) return true;
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);
        requestIOSPackStateRefresh(c);
        if (bridge && typeof bridge.isPackInstalled === "function") {
            try {
                return !!bridge.isPackInstalled(assetId);
            } catch (e) {
                console.error(`[WonderLang PAD] iOS isPackInstalled failed for "${assetId}".`, e);
                return false;
            }
        }
        return false;
    }

    if (hasAndroidManagerBridge() && typeof window.AndroidManager.isPackInstalled === "function") {
        try {
            return !!window.AndroidManager.isPackInstalled(c);
        } catch (e) {
            console.error(`[WonderLang PAD] AndroidManager.isPackInstalled failed for "${c}".`, e);
            return false;
        }
    }

    if (FORCE_ANDROID && Utils.isNwjs() && checkLocalFolder(c)) return true;
    if (FORCE_ANDROID && MOCK_INSTALLED[c]) return true;

    return false;
}

function startNativeDownload(code) {
    const c = normalizePackCode(code);

    if (isBuiltInPackCode(c)) {
        MOCK_INSTALLED[c] = true;
        console.info(`[WonderLang PAD] Pack "${c}" is built in. No download needed.`);
        return true;
    }

    if (!isDownloadablePackCode(c)) {
        console.error(
            `[WonderLang PAD] Blocked invalid download request for "${c || "EMPTY"}". ` +
            `Allowed downloads: ${Array.from(activeConfig().downloadablePackCodes).join(", ") || "none"}.`
        );
        return false;
    }

    if (!isDeviceOnline()) {
        console.warn(`[WonderLang PAD] Download blocked because the device is offline: ${c}`);
        USER_STARTED_DOWNLOADS.delete(c);
        return false;
    }

    USER_STARTED_DOWNLOADS.add(c);

    if (isIOSRuntime()) {
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);

        if (bridge && typeof bridge.downloadPack === "function") {
            try {
                bridge.downloadPack(assetId);
                console.info(`[WonderLang PAD] Native iOS ODR download requested for "${c}" (${assetId}).`);
                return true;
            } catch (e) {
                console.error(`[WonderLang PAD] Native iOS download call failed for "${c}" (${assetId}).`, e);
                USER_STARTED_DOWNLOADS.delete(c);
                return false;
            }
        }

        if (FORCE_IOS) {
            console.warn(`[WonderLang PAD] Force iOS Mode is ON. Using mock iOS download for "${c}" (${assetId}).`);
            if (MOCK_DOWNLOAD_TIMERS[c]) clearTimeout(MOCK_DOWNLOAD_TIMERS[c]);
            MOCK_DOWNLOAD_TIMERS[c] = setTimeout(() => {
                MOCK_INSTALLED[c] = true;
                delete MOCK_DOWNLOAD_TIMERS[c];
            }, 3000);
            return true;
        }

        console.error(
            `[WonderLang PAD] Cannot download "${c}" because ${IOS_BRIDGE_OBJECT}.downloadPack is not available.`
        );
        USER_STARTED_DOWNLOADS.delete(c);
        return false;
    }

    if (hasAndroidDownloadBridge()) {
        try {
            window.AndroidManager.downloadPack(c);
            console.info(`[WonderLang PAD] Native Android download requested for "${c}".`);
            return true;
        } catch (e) {
            console.error(`[WonderLang PAD] Native Android download call failed for "${c}".`, e);
            USER_STARTED_DOWNLOADS.delete(c);
            return false;
        }
    }

    if (FORCE_ANDROID) {
        console.warn(`[WonderLang PAD] Force Android Mode is ON. Using mock download for "${c}".`);
        if (MOCK_DOWNLOAD_TIMERS[c]) clearTimeout(MOCK_DOWNLOAD_TIMERS[c]);
        MOCK_DOWNLOAD_TIMERS[c] = setTimeout(() => {
            MOCK_INSTALLED[c] = true;
            delete MOCK_DOWNLOAD_TIMERS[c];
        }, 3000);
        return true;
    }

    console.error(
        `[WonderLang PAD] Cannot download "${c}" because AndroidManager.downloadPack is not available. ` +
        `The plugin will not fake a successful download on a real Android build.`
    );
    USER_STARTED_DOWNLOADS.delete(c);
    return false;
}

function cancelNativeDownload(code) {
    const c = normalizePackCode(code);

    if (!c || isBuiltInPackCode(c) || !isDownloadablePackCode(c)) return false;

    USER_STARTED_DOWNLOADS.delete(c);

    if (MOCK_DOWNLOAD_TIMERS[c]) {
        clearTimeout(MOCK_DOWNLOAD_TIMERS[c]);
        delete MOCK_DOWNLOAD_TIMERS[c];
    }

    if (isIOSRuntime()) {
        const bridge = getIOSManagerBridge();
        const assetId = nativeAssetPackIdForCode(c);

        if (bridge && typeof bridge.cancelPack === "function") {
            try {
                bridge.cancelPack(assetId);
                console.info(`[WonderLang PAD] Native iOS ODR cancellation requested for "${c}" (${assetId}).`);
                return true;
            } catch (e) {
                console.error(`[WonderLang PAD] Native iOS cancel call failed for "${c}" (${assetId}).`, e);
                return false;
            }
        }

        if (FORCE_IOS) {
            delete MOCK_INSTALLED[c];
            return true;
        }

        console.warn(`[WonderLang PAD] Cannot cancel "${c}" because ${IOS_BRIDGE_OBJECT}.cancelPack is not available.`);
        return false;
    }

    if (hasAndroidManagerBridge()) {
        const methodNames = ["cancelPack", "cancelDownload", "cancelPackDownload"];
        for (const methodName of methodNames) {
            if (typeof window.AndroidManager[methodName] === "function") {
                try {
                    window.AndroidManager[methodName](c);
                    console.info(`[WonderLang PAD] Native Android cancellation requested for "${c}" via ${methodName}.`);
                    return true;
                } catch (e) {
                    console.error(`[WonderLang PAD] Native Android cancel call failed for "${c}" via ${methodName}.`, e);
                    return false;
                }
            }
        }
    }

    if (FORCE_ANDROID) {
        delete MOCK_INSTALLED[c];
        return true;
    }

    console.warn(`[WonderLang PAD] No native cancel method is available for "${c}". Clearing local downloader state only.`);
    return false;
}

window.WL_AssetPackDebug = {
    platform: () => activeConfig().platform,
    builtInPacks: () => Array.from(activeConfig().builtInPackCodes),
    downloadablePacks: () => Array.from(activeConfig().downloadablePackCodes),
    allKnownPacks: () => Array.from(activeConfig().allKnownPackCodes),
    iOSPacks: IOS_PACKS,
    products: () => activeProducts(),
    restoreProducts: () => RESTORE_PRODUCTS.slice(),
    forceAndroidMode: () => FORCE_ANDROID,
    forceIOSMode: () => FORCE_IOS,
    isInstalled: isPackInstalled,
    status: getNativePackStatus,
    progress: getNativePackProgress,
    size: getNativePackDownloadSize,
    error: getNativePackError
};

    function normalizeSkuForPlatform(sku) {
        const raw = String(sku || "").trim();
        return isIOSRuntime() ? raw : raw.toLowerCase();
    }

    function getBundleSku() {
        const bundle = activeProducts().find(p => p.isBundle === "true" || p.isBundle === true);
        return normalizeSkuForPlatform(bundle?.sku || "wonderlangfull");
    }

    function hasAndroidBillingBridge() {
        return hasAndroidManagerBridge() &&
            typeof window.AndroidManager.purchase === "function";
    }

    function hasIOSBillingBridge() {
        const bridge = getIOSManagerBridge();
        return !!bridge && typeof bridge.purchase === "function";
    }

    function isDeviceOnline() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.isOnline === "function") {
                try { return !!bridge.isOnline(); } catch (_) { return false; }
            }
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.isOnline === "function") {
            try { return !!window.AndroidManager.isOnline(); } catch (_) { return false; }
        }
        return navigator.onLine !== false;
    }

    function isNativeBillingReady() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.isBillingReady === "function") {
                try { return !!bridge.isBillingReady(); } catch (_) { return false; }
            }
            return FORCE_IOS ? true : !!bridge;
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.isBillingReady === "function") {
            try { return !!window.AndroidManager.isBillingReady(); } catch (_) { return false; }
        }
        return true;
    }

    function getNativePurchaseStatus() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.getLastPurchaseStatus === "function") {
                try { return String(bridge.getLastPurchaseStatus() || "IDLE").toUpperCase(); } catch (_) { return "UNKNOWN"; }
            }
            if (FORCE_IOS) return "IDLE";
            return bridge ? "IDLE" : "IOS_BRIDGE_MISSING";
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.getLastPurchaseStatus === "function") {
            try { return String(window.AndroidManager.getLastPurchaseStatus() || "IDLE").toUpperCase(); } catch (_) { return "UNKNOWN"; }
        }
        return "IDLE";
    }

    function getNativePurchaseMessage() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.getLastPurchaseMessage === "function") {
                try { return String(bridge.getLastPurchaseMessage() || ""); } catch (_) { return ""; }
            }
            return "";
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.getLastPurchaseMessage === "function") {
            try { return String(window.AndroidManager.getLastPurchaseMessage() || ""); } catch (_) { return ""; }
        }
        return "";
    }

    function clearNativePurchaseState() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.clearLastPurchaseState === "function") {
                try { bridge.clearLastPurchaseState(); } catch (_) {}
            }
            return;
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.clearLastPurchaseState === "function") {
            try { window.AndroidManager.clearLastPurchaseState(); } catch (_) {}
        }
    }

    function refreshNativePurchases() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.refreshPurchases === "function") {
                try { return !!bridge.refreshPurchases(); } catch (_) { return false; }
            }
            return FORCE_IOS ? true : !!bridge;
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.refreshPurchases === "function") {
            try { return !!window.AndroidManager.refreshPurchases(); } catch (_) { return false; }
        }
        return true;
    }

    function syncNativePurchases() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.syncPurchases === "function") {
                try { return !!bridge.syncPurchases(); } catch (_) { return false; }
            }
            return false;
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.syncPurchases === "function") {
            try { return !!window.AndroidManager.syncPurchases(); } catch (_) { return false; }
        }

        // Older builds have only refreshPurchases(), which also changes the
        // purchase-flow status. Never call it while checkout has an active or
        // terminal result, because that would erase QUERYING/FLOW/CANCEL state.
        const status = getNativePurchaseStatus();
        const protectedStatuses = new Set([
            "ACCOUNT_SYNCING",
            "QUERYING",
            "FLOW_LAUNCHED",
            "VERIFYING",
            "PENDING",
            "CANCELED",
            "PURCHASED",
            "ITEM_ALREADY_OWNED"
        ]);
        if (protectedStatuses.has(status)) return false;
        return refreshNativePurchases();
    }

    function getNativePendingPurchaseCount() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.getPendingPurchaseCount === "function") {
                try { return Math.max(0, Number(bridge.getPendingPurchaseCount()) || 0); } catch (_) {}
            }
            return 0;
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.getPendingPurchaseCount === "function") {
            try { return Math.max(0, Number(window.AndroidManager.getPendingPurchaseCount()) || 0); } catch (_) {}
        }
        return 0;
    }

    function refreshNativeProductDetails() {
        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.refreshProductDetails === "function") {
                try {
                    const result = bridge.refreshProductDetails();
                    return result !== false && String(result || "").toUpperCase() !== "FALSE";
                } catch (_) {
                    return false;
                }
            }
            return FORCE_IOS || !!bridge;
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.refreshProductDetails === "function") {
            try {
                const result = window.AndroidManager.refreshProductDetails();
                return result !== false && String(result || "").toUpperCase() !== "FALSE";
            } catch (_) {
                return false;
            }
        }
        return FORCE_ANDROID;
    }

    function getNativeProductDetailsState(sku) {
        const normalizedSku = normalizeSkuForPlatform(sku);

        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.getProductDetailsState === "function") {
                try { return String(bridge.getProductDetailsState(normalizedSku) || "UNKNOWN").toUpperCase(); } catch (_) {}
            }
            return getNativePriceDetails(normalizedSku, "").live ? "READY" : "LOADING";
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.getProductDetailsState === "function") {
            try { return String(window.AndroidManager.getProductDetailsState(normalizedSku) || "UNKNOWN").toUpperCase(); } catch (_) {}
        }
        if (!hasNativePurchaseBridge()) return "BRIDGE_MISSING";
        if (!isNativeBillingReady()) return "BILLING_NOT_READY";
        return getNativePriceDetails(normalizedSku, "").live ? "READY" : "LOADING";
    }

    function getNativeProductDetailsMessage(sku) {
        const normalizedSku = normalizeSkuForPlatform(sku);

        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.getProductDetailsMessage === "function") {
                try { return String(bridge.getProductDetailsMessage(normalizedSku) || ""); } catch (_) {}
            }
            return "";
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.getProductDetailsMessage === "function") {
            try { return String(window.AndroidManager.getProductDetailsMessage(normalizedSku) || ""); } catch (_) {}
        }
        return "";
    }

    function isDirectProductPurchased(sku) {
        const normalizedSku = normalizeSkuForPlatform(sku);
        if (!normalizedSku) return false;

        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.isPurchased === "function") {
                try { return !!bridge.isPurchased(normalizedSku); } catch (_) { return false; }
            }
            return !!MOCK_PURCHASED[normalizedSku];
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.isPurchased === "function") {
            try { return !!window.AndroidManager.isPurchased(normalizedSku); } catch (_) { return false; }
        }
        return !!MOCK_PURCHASED[normalizedSku];
    }

    function isAccountSignedIn() {
        const bridge = window.WLAccountManager;
        if (bridge && typeof bridge.isSignedInFromGame === "function") {
            try { return !!bridge.isSignedInFromGame(); } catch (_) {}
        }
        return !!window.WLAccountEntitlements?.account?.();
    }

    function openWonderLangAccount() {
        const bridge = window.WLAccountManager;
        if (bridge && typeof bridge.openAccount === "function") {
            try { return bridge.openAccount() !== false; } catch (_) {}
        }
        if (window.WLAccountEntitlements?.openAccount) {
            try { return window.WLAccountEntitlements.openAccount() !== false; } catch (_) {}
        }
        return false;
    }

    function isProductPurchased(sku) {
        const normalizedSku = normalizeSkuForPlatform(sku);
        const bundleSku = getBundleSku();
        const accountOwned = window.WLAccountEntitlements?.isProductPurchased?.(normalizedSku) === true;
        if (accountOwned) return true;

        // The native/account bridge owns the dated chapter-to-full migration decision.
        // JavaScript must not infer permanent full access from an undated chapter receipt.

        const ownsBundle = normalizedSku !== bundleSku && (
            isIOSRuntime()
                ? (() => {
                    const bridge = getIOSManagerBridge();
                    if (bridge && typeof bridge.isPurchased === "function") return !!bridge.isPurchased(bundleSku);
                    return !!MOCK_PURCHASED[bundleSku];
                })()
                : ((hasAndroidManagerBridge() && typeof window.AndroidManager.isPurchased === "function")
                    ? window.AndroidManager.isPurchased(bundleSku)
                    : !!MOCK_PURCHASED[bundleSku])
        );

        if (ownsBundle) return true;

        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.isPurchased === "function") {
                return !!bridge.isPurchased(normalizedSku);
            }
            return !!MOCK_PURCHASED[normalizedSku];
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.isPurchased === "function") {
            return window.AndroidManager.isPurchased(normalizedSku);
        }
        return !!MOCK_PURCHASED[normalizedSku];
    }

    function startNativePurchase(sku) {
        const normalizedSku = normalizeSkuForPlatform(sku);

        if (!normalizedSku) return "INVALID_SKU";
        if (!isDeviceOnline()) return "OFFLINE";

        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (!bridge) {
                if (FORCE_IOS) {
                    setTimeout(() => { MOCK_PURCHASED[normalizedSku] = true; }, 3000);
                    return "MOCK_STARTED";
                }
                return "IOS_BRIDGE_MISSING";
            }
            if (!isNativeBillingReady()) return "BILLING_NOT_READY";
            if (typeof bridge.purchase === "function") {
                const result = bridge.purchase(normalizedSku);
                return result ? String(result).toUpperCase() : "STARTED";
            }
            return "PURCHASE_BRIDGE_MISSING";
        }

        if (hasAndroidBillingBridge()) {
            if (!isNativeBillingReady()) return "BILLING_NOT_READY";
            const result = window.AndroidManager.purchase(normalizedSku);
            return result ? String(result).toUpperCase() : "STARTED";
        }

        if (FORCE_ANDROID) {
            setTimeout(() => { MOCK_PURCHASED[normalizedSku] = true; }, 3000);
            return "MOCK_STARTED";
        }

        // Production must fail closed. A missing Android bridge must never grant a
        // mock entitlement or show a false purchase-success state.
        return "PURCHASE_BRIDGE_MISSING";
    }

    function getNativePriceDetails(sku, fallback) {
        const normalizedSku = normalizeSkuForPlatform(sku);

        if (isIOSRuntime()) {
            const bridge = getIOSManagerBridge();
            if (bridge && typeof bridge.getPrice === "function") {
                try {
                    const nativePrice = String(bridge.getPrice(normalizedSku) || "").trim();
                    if (nativePrice) return { text: nativePrice, live: true };
                } catch (_) {}
            }
            return FORCE_IOS ? { text: String(fallback || "$?.??"), live: true } : { text: "", live: false };
        }

        if (hasAndroidManagerBridge() && typeof window.AndroidManager.getPrice === "function") {
            try {
                const nativePrice = String(window.AndroidManager.getPrice(normalizedSku) || "").trim();
                if (nativePrice) return { text: nativePrice, live: true };
            } catch (_) {}
        }
        return FORCE_ANDROID ? { text: String(fallback || "$?.??"), live: true } : { text: "", live: false };
    }

    function parseLocalizedPrice(priceText) {
        const text = String(priceText || "");
        const match = text.match(/\d(?:[\d.,'’]|\s+(?=\d))*/);
        if (!match) return null;

        const raw = match[0].trim();
        const punctuation = raw.replace(/[\d\s]/g, "");
        const lastDot = raw.lastIndexOf(".");
        const lastComma = raw.lastIndexOf(",");
        let decimalSeparator = "";

        if (lastDot >= 0 && lastComma >= 0) {
            decimalSeparator = lastDot > lastComma ? "." : ",";
        } else if (lastDot >= 0 || lastComma >= 0) {
            const separator = lastDot >= 0 ? "." : ",";
            const occurrences = punctuation.split(separator).length - 1;
            const digitsAfter = raw.length - raw.lastIndexOf(separator) - 1;
            if (occurrences === 1 && digitsAfter > 0 && digitsAfter <= 2) decimalSeparator = separator;
        }

        const groupingCandidates = [".", ",", "'", "’"].filter(separator =>
            separator !== decimalSeparator && raw.includes(separator)
        );
        const spacingSeparator = raw.match(/\s/)?.[0] || "";
        const groupingSeparator = groupingCandidates[0] || spacingSeparator;
        let normalized = raw.replace(/[\s'’]/g, "");
        [".", ","].forEach((separator) => {
            if (separator === decimalSeparator) normalized = normalized.replace(separator, ".");
            else normalized = normalized.split(separator).join("");
        });

        const value = Number(normalized);
        if (!Number.isFinite(value)) return null;
        return {
            value,
            match,
            decimalSeparator,
            groupingSeparator,
            decimals: decimalSeparator ? raw.length - raw.lastIndexOf(decimalSeparator) - 1 : 0
        };
    }

    function formatPriceLike(samplePrice, value) {
        const details = parseLocalizedPrice(samplePrice);
        if (!details || !Number.isFinite(value)) return "";

        const fixed = Math.max(0, value).toFixed(details.decimals);
        let [integerPart, decimalPart] = fixed.split(".");
        if (details.groupingSeparator) {
            integerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, details.groupingSeparator);
        }
        const formattedNumber = decimalPart != null
            ? `${integerPart}${details.decimalSeparator || "."}${decimalPart}`
            : integerPart;
        return String(samplePrice).replace(details.match[0], formattedNumber);
    }

    function localizedSavings(bundlePrice, chapterPrices) {
        const bundleDetails = parseLocalizedPrice(bundlePrice);
        const chapterDetails = chapterPrices.map(parseLocalizedPrice);
        if (!bundleDetails || chapterDetails.some(details => !details)) return null;

        const chaptersTotal = chapterDetails.reduce((sum, details) => sum + details.value, 0);
        const saving = chaptersTotal - bundleDetails.value;
        if (!(saving > 0) || !(chaptersTotal > 0)) return null;
        return {
            amount: formatPriceLike(bundlePrice, saving),
            percent: Math.round((saving / chaptersTotal) * 100)
        };
    }

    Game_Interpreter.prototype.ownsProduct = function(sku) { return isProductPurchased(sku); };

    // ------------- Translation Helpers -------------
    function langWithJpVariant(raw) {
        const code = String(raw || "").trim();
        if (code.toUpperCase() === "JP") return ($gameVariables.value(172) === 1) ? "JP" : "JP_hir";
        if (code.toUpperCase() === "ZH") {
            const mode172 = Number($gameVariables.value(172) || 0);
            if (mode172 === 1 || mode172 === 2) return "ZH_hir";
            if (mode172 === 3 || mode172 === 4) return "ZH_trad";
            return "ZH";
        }
        if (code.toUpperCase() === "AR") return ($gameVariables.value(172) === 0) ? "AR" : "AR_hir";
        return code;
    }
    
    function getUiLanguageUpper2() {
        return String(ConfigManager?.uiLanguage || "EN").toUpperCase();
    }
    
    function detectBaseLanguageCode()  { return langWithJpVariant(getUiLanguageUpper2()); }

    let menuTranslations = null;
    function tr(key, lang) {
        const base = detectBaseLanguageCode();
        const L = langWithJpVariant(lang || base || "EN");
        if (!menuTranslations) return key;
        const candidates = [L, String(L).toLowerCase(), String(L).toUpperCase()];
        for (const c of candidates) if (menuTranslations[c]?.[key] != null) return menuTranslations[c][key];
        if (menuTranslations.en?.[key] != null) return menuTranslations.en[key];
        return key;
    }

    function loadMenuTranslations() {
        return new Promise((resolve) => {
            if (menuTranslations) return resolve();
            try {
                const xhr = new XMLHttpRequest();
                xhr.open("GET", `texts/menu.json`);
                xhr.overrideMimeType("application/json");
                xhr.onload = () => {
                    if (xhr.status < 400) {
                        const data = JSON.parse(xhr.responseText);
                        menuTranslations = data.translations || data;
                    }
                    resolve();
                };
                xhr.onerror = () => resolve();
                xhr.send();
            } catch(_) { resolve(); }
        });
    }

    const tdb = (txt) => { try { if (window.Ignis?.TextDatabase?.replaceText && typeof txt === "string") return Ignis.TextDatabase.replaceText(txt); } catch(_) {} return txt; };

    function trFormat(key, fallback, replacements = {}) {
        let raw = tr(key);
        if (!raw || raw === key) raw = fallback || "";
        let text = String(raw || "");
        Object.keys(replacements).forEach((name) => {
            text = text.replace(new RegExp(`\\{${name}\\}`, "g"), replacements[name]);
        });
        return tdb(text);
    }

    // ------------- Base HTML UI Class -------------
    class Scene_HtmlOverlay extends Scene_Base {
        prepare(missingLangName, forceTitle) {
            this._missingLangName = missingLangName;
            this._forceTitle = forceTitle;
        }

        create() { super.create(); this.createBackground(); }
        start() { super.start(); this.openUI(); }
        stop() { super.stop(); this.closeUI(); }
        createBackground() { this._backgroundSprite = new Sprite(); this._backgroundSprite.bitmap = SceneManager.backgroundBitmap(); this.addChild(this._backgroundSprite); }
        
        async openUI() {
            if (this._root) return;
            
            await loadMenuTranslations();

            this._pollInterval = null;
            let root = document.createElement("div");
            root.id = "htmlOverlaySimple";
            Object.assign(root.style, { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: "97vw", height: "98vh", zIndex: 99999 });
            root.innerHTML = `<style>${this.css()}</style>${this.html()}`;
            document.body.appendChild(root);
            this._root = root;
            this.wire();
            this.renderContent();

            if (this._missingLangName) {
                const rawAlert = tr("Alert_MissingLang") || "This save file requires the {LANG} pack to be loaded. Please download it.";
                const msg = tdb(rawAlert.replace("{LANG}", `<span style="color:var(--highlight); font-weight:bold;">${this._missingLangName}</span>`));
                const alertTextEl = this.$("#alert-text");
                if (alertTextEl) {
                    alertTextEl.innerHTML = msg;
                    this.$(".alert-modal").classList.remove("hidden");
                }
            }
        }

        closeUI() { if (this._pollInterval) clearInterval(this._pollInterval); if (this._renderInterval) clearInterval(this._renderInterval); this._pollInterval = null; this._renderInterval = null; if (this._root) { this._root.remove(); this._root = null; } }
        $ (s) { return this._root ? this._root.querySelector(s) : null; }
        
        onReturnButtonPressed() {
            if (this._forceTitle) SceneManager.goto(Scene_Title);
            else SceneManager.pop();
        }

        onSuccessButtonPressed() {
            this.$(".success-modal")?.classList.add("hidden");
            this.renderContent();
        }

        onDownloadModalClose() {
            if (this._pollInterval) clearInterval(this._pollInterval);
            this._pollInterval = null;
            this.$(".dl-modal")?.classList.add("hidden");
        }

        bindReleaseTap(target, action) {
            const button = typeof target === "string" ? this.$(target) : target;
            if (!button) return;

            let touchStart = null;
            let lastTouchAt = 0;

            button.addEventListener("touchstart", event => {
                event.stopPropagation();
                const touch = event.changedTouches?.[0];
                touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
            }, { passive: true });

            button.addEventListener("touchmove", event => {
                event.stopPropagation();
            }, { passive: true });

            button.addEventListener("touchcancel", event => {
                event.stopPropagation();
                touchStart = null;
            }, { passive: true });

            button.addEventListener("touchend", event => {
                event.stopPropagation();
                const touch = event.changedTouches?.[0];
                const moved = !touchStart || !touch ||
                    Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 16;
                touchStart = null;
                if (moved || button.disabled) return;
                if (event.cancelable) event.preventDefault();
                lastTouchAt = Date.now();
                action();
            }, { passive: false });

            button.addEventListener("click", event => {
                event.stopPropagation();
                if (button.disabled || Date.now() - lastTouchAt < 750) {
                    if (event.cancelable) event.preventDefault();
                    return;
                }
                action();
            });
        }

        wireBase() {
            const bind = (selector, action) => {
                this.bindReleaseTap(selector, action);
            };
            
            bind(".return-btn", () => {
                SoundManager.playCancel?.();
                this.onReturnButtonPressed();
            });
            
            bind(".ls-modal-no", () => { SoundManager.playCancel?.(); this.$(".confirm-modal").classList.add("hidden"); });
            bind(".dl-cancel-btn", () => {
                SoundManager.playCancel?.();
                this.onDownloadModalClose();
            });
            bind(".success-ok-btn", () => { SoundManager.playOk?.(); this.onSuccessButtonPressed(); });
            
            return bind;
        }
    }

    // ------------- Downloader Scene -------------
    class Scene_AssetDownloader extends Scene_HtmlOverlay {
        onReturnButtonPressed() {
            if ($gameTemp) $gameTemp._wlDownloaderReturnToLanguageSelect = false;
            super.onReturnButtonPressed();
        }

        onSuccessButtonPressed() {
            this.$(".success-modal")?.classList.add("hidden");
            this.onReturnButtonPressed();
        }

        css() {
            return `
            :root { --primary-bg: rgba(0,0,0,.94); --secondary-bg: rgba(92,21,129,.94); --accent-gradient: linear-gradient(0deg, rgba(0,0,0,.33), rgba(92,21,129,.94)); --highlight: #f1c40f; --button-grad: linear-gradient(135deg, #F1C40F 0%, #ED8936 100%); }
            .ls-menu { position:absolute; left:50%; top:50%; transform:translate(-50%, -50%); width:98vw; height:98vh; padding:1.2vh; background:linear-gradient(to bottom right, var(--primary-bg), var(--secondary-bg)); border-radius:2vh; color:#fff; font-family: sans-serif; }
            .topbar { height:8vh; display:flex; align-items:center; background:var(--accent-gradient); border-radius:1.4vh; padding:1.2vh; }
            .title { font-weight:900; font-size:3vh; color:var(--highlight); } .spacer { flex:1 1 auto; }
            .return-btn { background:var(--button-grad); color:#fff; border:none; border-radius:1vh; padding:2vh 7vw; font-weight:900; cursor:pointer; font-size:3vh; transition: transform 0.1s; }
            .return-btn:active { transform: scale(0.95); }
            .content { position:absolute; left:1.2vh; right:1.2vh; top:11.6vh; bottom:1.2vh; display:flex; flex-direction:column; gap:1.2vh; }
            .grid-wrap { flex: 1; background:var(--accent-gradient); border-radius:1.4vh; padding:1.2vh; overflow-y:auto; }
            .grid { display:grid; grid-template-columns: repeat(3, 1fr); gap: 1.1vw; }
            .action-btn { display:flex; flex-direction: column; align-items:center; justify-content:center; height: 12vh; border-radius:1.2vh; background: rgb(22 3 30 / 55%); color:#fff; font-weight:900; font-size:1.7vw; cursor:pointer; border: .6vh solid var(--color1); text-align:center; transition: all 0.1s ease; }
            .action-btn:active { transform: scale(0.92); filter: brightness(1.2); }
            .action-btn.owned { background: rgba(40, 167, 69, 0.2); border-color: #28a745 !important; opacity: 0.8; }
            .action-btn.owned:active { transform: none; filter: none; }
            .ls-modal { position:absolute; top:0; right:0; bottom:0; left:0; background:rgba(0,0,0,.7); display:none; align-items:center; justify-content:center; z-index: 100;}
            .ls-modal:not(.hidden) { display:flex; }
            .ls-modal-box { width:60vw; background:var(--primary-bg); border-radius:1.4vh; padding:3vh; text-align:center; }
            .ls-modal-text { font-size: 3vh; } .ls-modal-actions { display:flex; justify-content:center; gap:2vw; margin-top: 2vh;}
            .ls-modal-actions button { background:var(--button-grad); color:#fff; border:none; border-radius:1.6vh; padding:2vh 3vw; font-weight:900; font-size: 2vh; cursor:pointer; transition: transform 0.1s; }
            .ls-modal-actions button:active { transform: scale(0.95); }
            .ls-modal-actions.dl-actions { flex-direction:column; align-items:center; gap:1.2vh; }
            .ls-modal-actions.dl-actions button { min-width:22vw; }
            .dl-stop-btn { background:linear-gradient(135deg, #b91c1c 0%, #ef4444 100%) !important; }
            .dl-retry-btn { background:linear-gradient(135deg, #2563eb 0%, #38bdf8 100%) !important; }
            `;
        }
        html() {
            const t_title = tdb(tr("AssetDownloader_Title")) || "Download Assets";
            const t_return = tdb(tr("ReturnBtn")) || "Return";
            const t_cancel = tdb(tr("CancelBtn")) || "Cancel";
            const t_download = tdb(tr("DownloadBtn")) || "Download";
            const t_processing = tdb(tr("AssetDownloader_Processing")) || "Downloading...";
            const t_hide = tdb(tr("HideBtn")) || "Hide";
            const t_complete = tdb(tr("CompleteText")) || "Complete!";
            const t_awesome = tdb(tr("AwesomeBtn")) || "Awesome";
            const t_alertOk = tdb(tr("OKBtn")) || "OK";
            const t_mobileData = tdb(tr("Use mobile data")) || "Use mobile data";

            return `
            <div class="ls-menu">
                <div class="topbar"><div class="title">${t_title}</div><div class="spacer"></div><button class="return-btn">⟵ ${t_return}</button></div>
                <div class="content"><div class="grid-wrap"><div class="grid"></div></div></div>
                
                <div class="ls-modal confirm-modal hidden"><div class="ls-modal-box"><div class="ls-modal-text" id="confirm-text"></div><div class="ls-modal-actions"><button class="ls-modal-no">${t_cancel}</button><button class="ls-modal-yes" id="act-yes-btn">${t_download}</button></div></div></div>
                <div class="ls-modal dl-modal hidden"><div class="ls-modal-box"><div class="ls-modal-text" id="processing-text">${t_processing}</div><div class="ls-modal-actions dl-actions"><button class="mobile-data-btn" style="display:none;">${t_mobileData}</button><button class="dl-retry-btn" style="display:none;">${tdb(tr("Retry")) || "Retry"}</button><button class="dl-cancel-btn">${t_hide}</button><button class="dl-stop-btn" style="display:none;">${t_cancel}</button></div></div></div>
                <div class="ls-modal success-modal hidden"><div class="ls-modal-box"><div style="font-size: 5vh; color: #28a745;">✓</div><div class="ls-modal-text">${t_complete}</div><div class="ls-modal-actions"><button class="success-ok-btn">${t_awesome}</button></div></div></div>
                
                <div class="ls-modal alert-modal hidden"><div class="ls-modal-box"><div class="ls-modal-text" id="alert-text"></div><div class="ls-modal-actions"><button class="alert-ok-btn">${t_alertOk}</button></div></div></div>
            </div>`;
        }
        wire() {
            this._openedAt = Date.now();
            this._loggedDownloadResult = false;
            logAnalyticsEvent("language_pack_view", {
                source: this._missingLangName ? "missing_save_pack" : "language_selector"
            });
            if (this._renderInterval) clearInterval(this._renderInterval);
            this._renderInterval = setInterval(() => {
                if (!this._root) return;
                this.renderContent();
            }, 1000);
            const bind = this.wireBase();
            const triggerYes = (e) => { if(e && e.cancelable) e.preventDefault(); this.executeDownload(); };
            const btnYes = this.$("#act-yes-btn");
            if(btnYes) {
                btnYes.addEventListener("click", triggerYes);
                btnYes.addEventListener("touchstart", triggerYes, { passive: false });
            }
            bind(".dl-stop-btn", () => { this.cancelActiveDownload(); });
            bind(".dl-retry-btn", () => { this.retryActiveDownload(); });
            bind(".alert-ok-btn", () => { SoundManager.playOk?.(); this.$(".alert-modal").classList.add("hidden"); });
            const mobileBtn = this.$(".mobile-data-btn");
            if (mobileBtn) {
                const triggerMobileData = (e) => {
                    if (e && e.cancelable) e.preventDefault();
                    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
                    SoundManager.playOk?.();
                    const started = requestMobileDataDownload();
                    this.$("#processing-text").innerHTML = started
                        ? trFormat("AssetDownloader_MobileDataConfirm", "Please confirm the mobile data download in the {STORE} dialog.", { STORE: currentStoreName() })
                        : trFormat("AssetDownloader_MobileDataUnavailable", "Could not open the mobile data confirmation. Please connect to Wi-Fi or try again.");
                    mobileBtn.style.display = "none";
                };
                mobileBtn.addEventListener("click", triggerMobileData);
                mobileBtn.addEventListener("touchstart", triggerMobileData, { passive: false });
            }
        }
        
renderContent() {
    const host = this.$(".grid");
    if (!host) return;
    host.innerHTML = "";

    const t_installed = tdb(tr("AssetDownloader_Installed")) || "✓ Installed";

    activeConfig().displayPacks.forEach((pack) => {
        const b = document.createElement("button");
        b.className = "action-btn";
        b.style.setProperty("--color1", pack.color1 || "#ffd166");
        b.style.setProperty("--color2", pack.color2 || "#ef476f");

        const isReady = isPackInstalled(pack.code);
        const isDownloadingNow = !isReady && shouldShowPackDownloading(pack.code);
        const packStatus = isDownloadingNow ? getNativePackStatus(pack.code) : "NOT_INSTALLED";
        const displayName = packDisplayName(pack.code);

        b.innerHTML = `<div>${displayName}</div>`;

        if (isReady) {
            b.classList.add("owned");
            b.innerHTML += `<div class="owned-badge" style="font-size: 1vw; color: #28a745; margin-top: 5px;">${t_installed}</div>`;
        } else if (isDownloadingNow) {
            b.classList.add("owned");
            const badgeText = (packStatus === "WAITING_FOR_WIFI" || packStatus === "REQUIRES_USER_CONFIRMATION")
                ? (tdb(tr("Waiting for Wi-Fi")) || "Waiting for Wi-Fi")
                : (tdb(tr("Downloading")) || "Downloading...");
            b.innerHTML += `<div class="owned-badge" style="font-size: 1vw; color: #f1c40f; margin-top: 5px;">${badgeText}</div>`;
        }

        const trigger = (e) => {
            if (e && e.cancelable) e.preventDefault();

            
            // Ignore ghost clicks/touches caused by the tap that opened this scene.
            if (this._openedAt && Date.now() - this._openedAt < 600) return;

            if (isReady) {
                SoundManager.playBuzzer?.();
            } else if (isDownloadingNow) {
                SoundManager.playOk?.();
                this._activeItem = pack;
                this.executeDownload(true);
            } else {
                SoundManager.playOk?.();
                this.promptDownload(pack, displayName);
            }
        };

        b.addEventListener("click", trigger);
        b.addEventListener("touchstart", trigger, { passive: false });
        host.appendChild(b);
    });
}

        promptDownload(pack, displayName) {
            const packCode = normalizePackCode(pack?.code);

            if (isBuiltInPackCode(packCode)) {
                SoundManager.playOk?.();
                this._activeItem = pack;
                this.$(".success-modal")?.classList.remove("hidden");
                return;
            }

            if (!isDownloadablePackCode(packCode)) {
                SoundManager.playBuzzer?.();
                this.$("#processing-text").innerHTML =
                    tdb(trFormat("Downloader_Err_CannotDownload", "This language pack cannot be downloaded.<br><br>{DEBUG}", { DEBUG: packDebugSummary(packCode) }));
                this.$(".dl-modal")?.classList.remove("hidden");
                return;
            }

            this._activeItem = pack;
            const rawConfirm = tr("AssetDownloader_Confirm") || "Do you want to download {ITEM}?";
            const styledName = `<span style="color:var(--highlight); font-weight:bold;">${displayName}</span>`;
            this.$("#confirm-text").innerHTML = tdb(rawConfirm.replace("{ITEM}", styledName).replace("{LANG}", styledName));
            this.$(".confirm-modal").classList.remove("hidden");
        }

cancelActiveDownload() {
    const packCode = normalizePackCode(this._activeItem?.code);
    if (!packCode) return;

    SoundManager.playCancel?.();

    if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
    }

    const stopped = cancelNativeDownload(packCode);
    USER_STARTED_DOWNLOADS.delete(packCode);
    if (!this._loggedDownloadResult) {
        this._loggedDownloadResult = true;
        logAnalyticsEvent("language_pack_result", {
            pack: packCode,
            result: "canceled",
            status: getNativePackStatus(packCode),
            progress_bucket: progressBucket(getNativePackProgress(packCode))
        });
    }

    if (!stopped && isIOSRuntime() && !FORCE_IOS) {
        const stopBtn = this.$(".dl-stop-btn");
        if (stopBtn) stopBtn.style.display = "none";
        this.$("#processing-text").innerHTML =
            tdb(trFormat("Downloader_Err_CancelFailed", "Could not cancel the {ASSET} download.<br><br>{DEBUG}", { ASSET: currentAssetDeliveryName(), DEBUG: packDebugSummary(packCode) }));
        return;
    }

    this._activeItem = null;
    this.$(".dl-modal")?.classList.add("hidden");
    this.renderContent();
}

retryActiveDownload() {
    if (!this._activeItem) return;
    SoundManager.playOk?.();
    if (this._pollInterval) {
        clearInterval(this._pollInterval);
        this._pollInterval = null;
    }
    this._loggedDownloadResult = false;
    this.executeDownload(false);
}

executeDownload(alreadyStarted = false) {
    this.$(".confirm-modal")?.classList.add("hidden");

    if (!this._activeItem) return;

    const packCode = normalizePackCode(this._activeItem.code);
    if (alreadyStarted && isDownloadablePackCode(packCode)) USER_STARTED_DOWNLOADS.add(packCode);
    const displayName = tdb(this._activeItem.text) || packDisplayName(packCode);
    const styledName = `<span style="color:var(--highlight); font-weight:bold;">${displayName}</span>`;

    const cancelBtn = this.$(".dl-cancel-btn");
    const stopBtn = this.$(".dl-stop-btn");
    const mobileBtn = this.$(".mobile-data-btn");
    const retryBtn = this.$(".dl-retry-btn");
    const setMobileDataButton = (visible) => {
        if (mobileBtn) mobileBtn.style.display = visible ? "" : "none";
    };
    const setStopButton = (visible) => {
        if (stopBtn) stopBtn.style.display = visible ? "" : "none";
    };
    const setRetryButton = (visible) => {
        if (retryBtn) retryBtn.style.display = visible ? "" : "none";
    };
    setMobileDataButton(false);
    setStopButton(false);
    setRetryButton(false);
    // Always keep Hide/Close available. The native asset download overlay must never trap the player.
    if (cancelBtn) cancelBtn.style.display = "";


    if (isBuiltInPackCode(packCode)) {
        this.$(".dl-modal")?.classList.add("hidden");
        AudioManager.playSe({ name: "Recovery", pan: 0, pitch: 100, volume: 90 });
        this.$(".success-modal")?.classList.remove("hidden");
        return;
    }

    if (!isDownloadablePackCode(packCode)) {
        this.$("#processing-text").innerHTML =
            tdb(trFormat("Downloader_Err_Blocked", "Blocked invalid language pack request.<br><br>{DEBUG}", { DEBUG: packDebugSummary(packCode) }));
        this.$(".dl-modal").classList.remove("hidden");
        if (cancelBtn) cancelBtn.style.display = "";
        setStopButton(false);
        setRetryButton(true);
        return;
    }

    if (!isDeviceOnline()) {
        this.$("#processing-text").innerHTML =
            tdb(trFormat("Downloader_Err_Offline", "You are offline.<br><br>Please connect to the internet to download {ITEM}.", { ITEM: styledName }));
        this.$(".dl-modal").classList.remove("hidden");
        if (cancelBtn) cancelBtn.style.display = "";
        setStopButton(false);
        setRetryButton(true);
        return;
    }

    const rawDL = tr("AssetDownloader_Downloading") || "Downloading {ITEM}...";
    this.$("#processing-text").innerHTML = tdb(rawDL.replace("{ITEM}", styledName).replace("{LANG}", styledName));
    this.$(".dl-modal").classList.remove("hidden");

    if (!alreadyStarted) {
        const started = startNativeDownload(packCode);
        if (!started) {
            if (!this._loggedDownloadResult) {
                this._loggedDownloadResult = true;
                logAnalyticsEvent("language_pack_result", {
                    pack: packCode,
                    result: "start_error",
                    status: getNativePackStatus(packCode),
                    progress_bucket: progressBucket(getNativePackProgress(packCode))
                });
            }
            this.$("#processing-text").innerHTML =
                tdb(trFormat("Downloader_Err_StartFailed", "Could not start the {ASSET} download.<br><br>Pack: {CODE}<br><br>This usually means the native bridge downloadPack method is missing, not exposed to JavaScript, or the pack name does not match the native asset pack ID.<br><br>{DEBUG}", {
                    ASSET: currentAssetDeliveryName(),
                    CODE: packCode,
                    DEBUG: packDebugSummary(packCode)
                }));
            if (cancelBtn) cancelBtn.style.display = "";
            setStopButton(false);
            setRetryButton(true);
            return;
        }
        this._loggedDownloadResult = false;
        logAnalyticsEvent("language_pack_start", {
            pack: packCode,
            status: getNativePackStatus(packCode)
        });
    }

    setStopButton(true);


    if (this._pollInterval) clearInterval(this._pollInterval);

    let ticks = 0;
    let lastProgress = -1;
    let lastStatus = "";
    let lastMovementTick = 0;
    let completedWaitTicks = 0;
    const maxNoMovementTicks = isIOSRuntime() ? 1600 : 120; // ODR can stay queued while iOS manages the transfer.

    const failWithMessage = (message, result = "error", statusOverride = "") => {
        const finalStatus = statusOverride || getNativePackStatus(packCode);
        USER_STARTED_DOWNLOADS.delete(packCode);
        clearInterval(this._pollInterval);
        this._pollInterval = null;
        this.$("#processing-text").innerHTML = `${message}<br><br>${packDebugSummary(packCode)}`;
        if (cancelBtn) cancelBtn.style.display = "";
        setMobileDataButton(false);
        setStopButton(false);
        setRetryButton(result !== "canceled");
        if (!this._loggedDownloadResult) {
            this._loggedDownloadResult = true;
            logAnalyticsEvent("language_pack_result", {
                pack: packCode,
                result,
                status: finalStatus,
                progress_bucket: progressBucket(getNativePackProgress(packCode)),
                error_code: getNativePackError(packCode)
            });
        }
        this.renderContent();
    };

    const refresh = () => {
        ticks++;

        const status = getNativePackStatus(packCode);
        const progress = getNativePackProgress(packCode);

        if (status !== lastStatus || progress !== lastProgress) {
            lastStatus = status;
            lastProgress = progress;
            lastMovementTick = ticks;
            setRetryButton(false);
        }

        const actuallyInstalled = isPackInstalled(packCode);

        if (status === "COMPLETED" && actuallyInstalled) {
            USER_STARTED_DOWNLOADS.delete(packCode);
            if (window.AudioPackManager) {
                AudioPackManager.invalidateLanguage(packCode);
                AudioPackManager.preloadLanguage(packCode);
            }
            clearInterval(this._pollInterval);
            this._pollInterval = null;

            this.$(".dl-modal").classList.add("hidden");
            if (cancelBtn) cancelBtn.style.display = "";
            setStopButton(false);
            setRetryButton(false);

            if ($gameTemp && $gameTemp._wlDownloaderReturnToLanguageSelect) {
                $gameTemp._wlLastDownloadedLanguageCode = packCode;
            }
            if (!this._loggedDownloadResult) {
                this._loggedDownloadResult = true;
                logAnalyticsEvent("language_pack_result", {
                    pack: packCode,
                    result: "success",
                    status,
                    progress_bucket: "100"
                });
            }

            AudioManager.playSe({ name: "Recovery", pan: 0, pitch: 100, volume: 90 });
            this.$(".success-modal").classList.remove("hidden");
            return;
        }

        if (status === "COMPLETED" && !actuallyInstalled) {
            completedWaitTicks++;
            this.$("#processing-text").innerHTML =
                tdb(trFormat("Downloader_Finalizing", "Finalizing {ITEM}...<br>Please wait while the system makes the files available.<br><br>{DEBUG}", { ITEM: styledName, DEBUG: packDebugSummary(packCode) }));

            if (completedWaitTicks > 30) {
                failWithMessage(
                    tdb(trFormat("Downloader_Err_NotAccessible", "{ASSET} reported the pack as complete, but the files are still not accessible.", { ASSET: currentAssetDeliveryName() })),
                    "not_accessible",
                    status
                );
            }
            return;
        }
        completedWaitTicks = 0;

        if (status === "INVALID") {
            failWithMessage(tdb(tr("Downloader_Err_Blocked")) || "Blocked invalid language pack request.", "invalid", status);
            return;
        }

        if (status === "BRIDGE_MISSING" || status === "BRIDGE_STATUS_MISSING" || status === "IOS_BRIDGE_MISSING" || status === "IOS_BRIDGE_STATUS_MISSING") {
            failWithMessage(tdb(tr("Downloader_Err_BridgeMissing")) || "The native asset pack bridge is missing or incomplete.", "bridge_error", status);
            return;
        }

        if (status === "FAILED" || status === "CANCELED" || status === "CONFIGURATION_ERROR" || status === "UNSUPPORTED") {
            const err = getNativePackError(packCode);
            const msg = err === -997 || err === -6
                ? (tdb(tr("Downloader_Err_Offline_General")) || "You are offline. Please connect to the internet and try again.")
                : (tdb(tr("Downloader_Err_DownloadFailed")) || "Download failed. Please check your connection and try again.");
            failWithMessage(msg, status === "CANCELED" ? "canceled" : "failed", status);
            return;
        }

        if (!isDeviceOnline()) {
            this.$("#processing-text").innerHTML =
                tdb(tr("Downloader_Err_Offline_General")) || "You are offline. Reconnect to continue, or retry the download.";
            setMobileDataButton(false);
            setRetryButton(true);
            return;
        }

        if (status === "WAITING_FOR_WIFI" || status === "REQUIRES_USER_CONFIRMATION") {
            this.$("#processing-text").innerHTML =
                tdb(trFormat("Downloader_WaitingWiFi", "{ASSET} is waiting for Wi-Fi.<br>{ITEM}<br><br>You can allow this download over your mobile data, or connect to Wi-Fi and continue.<br><br>{DEBUG}", { ASSET: currentAssetDeliveryName(), ITEM: styledName, DEBUG: packDebugSummary(packCode) }));
            if (cancelBtn) cancelBtn.style.display = "";
            setMobileDataButton(true);
            setRetryButton(false);
            return;
        }


        if (status === "TRANSFERRING" || status === "FINALIZING") {
            this.$("#processing-text").innerHTML =
                tdb(trFormat("Downloader_Installing", "Installing {ITEM}...<br>Please wait while the system makes the files available.<br><br>{DEBUG}", { ITEM: styledName, DEBUG: packDebugSummary(packCode) }));
            return;
        }

        if (status === "DOWNLOADING") {
            const detail = downloadProgressDetails(packCode, progress);
            if ((ticks - lastMovementTick) > maxNoMovementTicks) {
                const detailLine = detail
                    ? `<br>${detail.progress}% - ${detail.downloaded} / ${detail.total}`
                    : `<br>${progress}%`;
                this.$("#processing-text").innerHTML =
                    `${tdb(tr("Downloader_StillWaiting")) || "The download is still waiting. You can keep waiting or retry."}${detailLine}`;
                setRetryButton(true);
                return;
            }

            this.$("#processing-text").innerHTML =
                isIOSRuntime()
                    ? tdb(trFormat("Downloader_Downloading_iOS", "Downloading {ITEM}...<br>{PROGRESS}%<br><br>You can leave this screen; iOS will continue the request.", { ITEM: styledName, PROGRESS: progress }))
                    : detail
                        ? tdb(trFormat(
                            "Downloader_Downloading_Android_Detailed",
                            "Downloading {ITEM}...<br>{PROGRESS}% - {DOWNLOADED} / {TOTAL}<br><br>Please keep the app open.",
                            {
                                ITEM: styledName,
                                PROGRESS: detail.progress,
                                DOWNLOADED: detail.downloaded,
                                TOTAL: detail.total
                            }
                        ))
                        : tdb(trFormat("Downloader_Downloading_Android", "Downloading {ITEM}...<br>{PROGRESS}%<br><br>Please keep the app open.", { ITEM: styledName, PROGRESS: progress }));
            return;
        }

        if (status === "PENDING" || status === "NOT_INSTALLED" || status === "UNKNOWN") {
            if ((status === "NOT_INSTALLED" || status === "UNKNOWN") && ticks > 16) {
                this.$("#processing-text").innerHTML =
                    tdb(tr("Downloader_StillWaiting")) || "The download is still waiting. You can keep waiting or retry.";
                setRetryButton(true);
            } else {
                this.$("#processing-text").innerHTML =
                    tdb(trFormat("Downloader_Preparing", "Preparing {ITEM}...<br>Please wait.<br><br>Status: {STATUS}", { ITEM: styledName, STATUS: status }));
            }
        }
    };

    refresh();
    this._pollInterval = setInterval(refresh, 750);
}
    }

    function isBundleProduct(product) {
        return product?.isBundle === "true" || product?.isBundle === true;
    }

    function isSubscriptionProduct(product) {
        return product?.isSubscription === "true" || product?.isSubscription === true ||
            normalizeSkuForPlatform(product?.sku) === "wonderlangmonthly";
    }

    function productAnalyticsType(product) {
        if (isSubscriptionProduct(product)) return "subscription";
        if (isBundleProduct(product)) return "polyglot_permanent";
        return "legacy_chapter";
    }

    function chapterNumberForProduct(product) {
        const match = String(product?.sku || "").match(/(?:chapter|ch)(\d+)/i);
        return match ? Number(match[1]) : 0;
    }

    function orderedChapterProducts() {
        return RESTORE_PRODUCTS
            .filter(product => HISTORICAL_CHAPTER_SKUS.has(normalizeSkuForPlatform(product?.sku)))
            .slice()
            .sort((a, b) => chapterNumberForProduct(a) - chapterNumberForProduct(b));
    }

    function translatedValue(key, fallback) {
        const value = tr(key);
        return tdb(value && value !== key ? value : fallback || "");
    }

    function productDisplayName(product) {
        if (isSubscriptionProduct(product)) {
            return translatedValue("Paywall_Product_Monthly_Title", product?.text || "WonderLang Monthly");
        }
        if (isBundleProduct(product)) {
            return translatedValue("Paywall_Product_Polyglot_Title", product?.text || "Polyglot Permanent Access");
        }
        const chapterNumber = chapterNumberForProduct(product);
        return translatedValue(`Paywall_Product_Chapter${chapterNumber}_Title`, product?.text || `Chapter ${chapterNumber}`);
    }

    function productDisplayDescription(product) {
        if (isSubscriptionProduct(product)) {
            return translatedValue("Paywall_Product_Monthly_Description", "Every chapter, every language, and cloud saves. Cancel anytime.");
        }
        if (isBundleProduct(product)) {
            return translatedValue("Paywall_Product_Polyglot_Description", "Own the full game forever on this mobile platform. Cloud save is not included.");
        }
        return translatedValue("Paywall_Product_Chapter_Description", product?.description || "Approximately 15 hours of learning and adventure.");
    }

    function directChapterOwnership() {
        const chapters = orderedChapterProducts();
        const owned = chapters.filter(chapter => isDirectProductPurchased(chapter.sku));
        return {
            chapters,
            owned,
            count: owned.length,
            ownsAny: owned.length > 0,
            ownsAll: chapters.length > 0 && owned.length === chapters.length
        };
    }

    function shouldShowChapterOffers() {
        return false;
    }

    function productDetailsStatusText(product, priceDetails) {
        if (!hasNativePurchaseBridge()) {
            return translatedValue("Paywall_Err_PurchaseBridge", "Purchases are temporarily unavailable.");
        }

        const state = getNativeProductDetailsState(product?.sku);
        const message = getNativeProductDetailsMessage(product?.sku);
        if (priceDetails?.live && (state === "READY" || state === "AVAILABLE" || state === "SUCCESS")) return "";

        if (state === "BILLING_NOT_READY" || state === "BILLING_DISCONNECTED" || state === "DISCONNECTED") {
            return message || trFormat("Paywall_Err_StoreNotReady", "{STORE} is not ready yet.", { STORE: currentStoreName() });
        }
        if (
            state === "UNAVAILABLE" ||
            state === "UNAVAILABLE_IN_REGION" ||
            state === "PRODUCT_NOT_FOUND" ||
            state === "NOT_FOUND" ||
            state === "MISSING" ||
            state === "NOT_CONFIGURED"
        ) {
            return message || trFormat("Paywall_Err_LoadFailed", "{STORE} could not load this product.", { STORE: currentStoreName() });
        }
        if (state.includes("FAILED") || state.includes("ERROR")) {
            return message || trFormat("Paywall_Err_LoadFailed", "{STORE} could not load this product.", { STORE: currentStoreName() });
        }
        return translatedValue("Paywall_LoadingPrice", "Loading local price...");
    }

    function hasNativePurchaseBridge() {
        if (isIOSRuntime()) return FORCE_IOS || hasIOSBillingBridge();
        return FORCE_ANDROID || hasAndroidBillingBridge();
    }

    // ------------- Paywall Scene (Premium Store UI) -------------
    class Scene_Paywall extends Scene_HtmlOverlay {
        prepare(context) {
            this._paywallContext = String(context || "");
        }

        paywallElapsedBucket() {
            const elapsedMs = Math.max(0, Date.now() - (this._paywallOpenedAt || Date.now()));
            if (elapsedMs < 5000) return "0_5s";
            if (elapsedMs < 15000) return "5_15s";
            if (elapsedMs < 30000) return "15_30s";
            if (elapsedMs < 60000) return "30_60s";
            if (elapsedMs < 120000) return "1_2m";
            return "2m_plus";
        }

        logPaywallClose(reason) {
            if (this._paywallCloseLogged) return;
            this._paywallCloseLogged = true;
            logAnalyticsEvent("paywall_close", {
                context: this._paywallContext || "unknown",
                reason: reason || "scene_exit",
                elapsed_bucket: this.paywallElapsedBucket(),
                offer_structure: this.currentOfferStructure()
            });
        }

        onReturnButtonPressed() {
            this.logPaywallClose("back");
            super.onReturnButtonPressed();
        }

        stop() {
            this.logPaywallClose(this._paywallCloseReason || "scene_exit");
            super.stop();
        }

        css() {
            return `
            :root { 
                --store-bg: #0a0e17; 
                --card-bg: #151b2b; 
                --border-color: #2a3441;
                --gold: #ffd700;
                --gold-grad: linear-gradient(135deg, #ffd700, #ff8c00);
                --buy-bg: #28a745;
                --owned-bg: #4a5568;
                --text-main: #ffffff;
                --text-sub: #a0aec0;
            }
            .store-menu { position:absolute; left:0; top:0; width:100%; height:100%; background:var(--store-bg); color:var(--text-main); font-family: 'NotoSans', sans-serif; display:flex; flex-direction:column; padding: 2vh; box-sizing: border-box; }
            .store-header { display:flex; justify-content:space-between; align-items:center; margin-bottom: 2vh; }
            .store-title { font-size: 3.5vh; font-weight: 800; color: var(--gold); text-transform: uppercase; letter-spacing: 2px; }
            .store-header-actions { display:flex; align-items:center; justify-content:flex-end; flex-wrap:wrap; gap:1vw; }
            .return-btn { background: transparent; color: var(--text-main); border: 2px solid var(--border-color); border-radius: 1vh; padding: 1.5vh 3vw; font-size: 2.2vh; font-weight: bold; cursor: pointer; transition: all 0.1s; }
            .return-btn:active { transform: scale(0.95); background: rgba(255,255,255,0.1); }
            .store-tool-btn { background:#1e293b; color:var(--text-main); border:1px solid #475569; border-radius:1vh; padding:1.5vh 2vw; font-size:1.9vh; font-weight:800; cursor:pointer; transition:all .1s; }
            .store-tool-btn:active { transform:scale(.95); background:#334155; }
            .store-tool-btn[disabled] { cursor:wait; opacity:.6; }
            
            .store-content { flex: 1; display:flex; flex-direction:column; gap: 2vh; overflow-y: auto; padding: 0 1vw 2vh 0; }
            .demo-complete { padding:2.4vh 3vw; border:1px solid #2563eb; border-radius:1.5vh; background:linear-gradient(135deg,rgba(37,99,235,.22),rgba(14,165,233,.08)); }
            .demo-complete-title { font-size:2.8vh; font-weight:900; margin-bottom:.8vh; }
            .demo-complete-body { color:#cbd5e1; font-size:1.9vh; line-height:1.45; }
            
            /* HERO BUNDLE CSS */
            .hero-bundle {
    background: linear-gradient(180deg, #1f1a0d, #151b2b);
    border: 2px solid var(--gold);
    border-radius: 2vh;
    padding: 4vh 4vw;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: relative;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(255, 215, 0, 0.1);
}
    .hero-ribbon { position: absolute; top: 20px; left: -35px; background: var(--gold-grad); color: #000; padding: 5px 40px; transform: rotate(-40deg); font-weight: 900; font-size: 1.5vh; letter-spacing: 1px; }
            .hero-info { flex: 1; padding-left: 4vw; }
            .hero-title { font-size: 4vh; font-weight: 900; margin-bottom: 1vh; color: #fff; }
            .hero-desc { font-size: 2.2vh; color: var(--text-sub); line-height: 1.4; max-width: 90%; }
            .hero-benefits { display:flex; flex-wrap:wrap; gap:.8vh 1.5vw; margin-top:1.4vh; color:#f8fafc; font-size:1.7vh; }
            .hero-benefit::before { content:'✓'; margin-right:.5em; color:var(--gold); font-weight:900; }
            .hero-saving { margin-top:1.2vh; color:var(--gold); font-size:1.8vh; font-weight:800; }
            
            /* CHAPTERS CSS */
            .chapters-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:1.5vh 1.5vw; }
            .chapter-card { background:rgba(21,27,43,.72); border:1px solid var(--border-color); border-radius:1.5vh; padding:2.2vh 2.5vw; display:flex; align-items:center; justify-content:space-between; gap:3vw; }
            .chapter-copy { flex:1; min-width:0; }
            .chapter-title { font-size: 2.5vh; font-weight: 700; margin-bottom: .7vh; }
            .chapter-desc { font-size: 1.8vh; color: var(--text-sub); margin-bottom: 2vh; flex: 1; }
            
            /* BUTTONS WITH TOUCH FEEDBACK */
            .price-btn { background: var(--buy-bg); color: #fff; border: none; border-radius: 1vh; padding: 1.5vh 2vw; font-size: 2.5vh; font-weight: bold; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap:.65em; min-width: 150px; white-space:nowrap; transition: all 0.1s ease; }
            .price-btn { touch-action:manipulation; -webkit-tap-highlight-color:transparent; user-select:none; }
            .price-btn:active { transform: scale(0.92); filter: brightness(0.85); }
            .hero-bundle .price-btn { background: var(--gold-grad); color: #000; padding: 2vh 4vw; font-size: 3vh; border-radius: 4vh; }
            .price-btn.owned { background: var(--owned-bg); color: #ccc; cursor: default; }
            .price-btn.owned:active { transform: none; filter: none; }
            .price-tag { font-weight: 900; }
            .price-loading { min-width:150px; padding:1.5vh 2vw; border:1px solid var(--border-color); border-radius:1vh; color:var(--text-sub); font-size:1.8vh; text-align:center; }
            
            /* MODALS */
            .ls-modal { position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.85); display:none; align-items:center; justify-content:center; z-index: 100; }
            .ls-modal:not(.hidden) { display:flex; }
            .ls-modal-box { width:50vw; background:var(--card-bg); border: 1px solid var(--border-color); border-radius: 2vh; padding: 4vh; text-align:center; }
            .ls-modal-text { font-size: 3vh; margin-bottom: 3vh; line-height: 1.4;}
            .ls-modal-actions { display:flex; justify-content:center; gap:2vw; }
            .ls-modal-actions button { background:var(--owned-bg); color:#fff; border:none; border-radius:1vh; padding:2vh 4vw; font-size: 2vh; font-weight: bold; cursor:pointer; transition: transform 0.1s; }
            .ls-modal-actions button:active { transform: scale(0.95); }
            .ls-modal-actions .ls-modal-yes { background:var(--buy-bg); }
            @media (max-width:760px) {
                .chapters-grid { grid-template-columns:1fr; }
                .hero-bundle, .chapter-card { flex-direction:column; align-items:stretch; }
                .hero-info { padding-left:6vw; }
                .hero-desc { max-width:100%; }
                .hero-action .price-btn, .chapter-card .price-btn, .price-loading { width:100%; box-sizing:border-box; }
                .store-header { align-items:flex-start; gap:1vw; }
                .store-header-actions { gap:.8vw; }
                .store-tool-btn, .return-btn { padding:1.2vh 1.5vw; font-size:1.7vh; }
            }
            `;
        }

        html() {
            const t_title = tdb(tr("Paywall_Title")) || "Premium Store";
            const t_return = tdb(tr("ReturnBtn")) || "Return";
            const t_restore = translatedValue("Paywall_RestorePurchases", "Restore purchases");
            const t_account = translatedValue("Paywall_Account", "Account");
            const t_connecting = trFormat("Paywall_ConnectingStore", "Connecting to {STORE}...", { STORE: currentStoreName() });
            const t_warning = tdb(tr("Paywall_Warning")) || "Please complete the transaction on your screen.";
            const t_close = tdb(tr("CloseBtn")) || "Close";
            const t_success = tdb(tr("Paywall_Success")) || "Purchase Successful!";
            const t_thanks = tdb(tr("Paywall_Thanks")) || "Thank you for your support.";
            const t_continue = tdb(tr("Paywall_ContinueBtn")) || "Continue Journey";

            return `
            <div class="store-menu">
                <div class="store-header">
                    <div class="store-title">${t_title}</div>
                    <div class="store-header-actions">
                        <button class="store-tool-btn account-btn">${t_account}</button>
                        <button class="store-tool-btn restore-purchases-btn">${t_restore}</button>
                    </div>
                    <button class="return-btn">⟵ ${t_return}</button>
                </div>
                <div class="store-content" id="store-content-area"></div>

                <div class="ls-modal dl-modal hidden"><div class="ls-modal-box"><div class="ls-modal-text" id="paywall-status-text">${t_connecting}</div><div id="paywall-status-subtext" style="font-size: 1.8vh; color:#888; margin-bottom:2vh;">${t_warning}</div><div class="ls-modal-actions"><button class="dl-cancel-btn">${t_close}</button></div></div></div>
                <div class="ls-modal success-modal hidden"><div class="ls-modal-box"><div style="font-size: 6vh; color: var(--gold); margin-bottom:1vh;">✦</div><div class="ls-modal-text">${t_success}</div><div style="font-size: 1.8vh; color:#888; margin-bottom:2vh;">${t_thanks}</div><div class="ls-modal-actions"><button class="success-ok-btn">${t_continue}</button></div></div></div>
            </div>`;
        }

        wire() {
            const bind = this.wireBase();
            this._paywallOpenedAt = Date.now();
            this._paywallCloseLogged = false;
            this._paywallCloseReason = "";
            this._purchaseInFlight = false;
            this._checkoutLoggedResults = new Set();
            this._entitlementSyncComplete = FORCE_ANDROID || FORCE_IOS;
            this._initialEntitlementSyncPending = false;
            this._initialEntitlementSyncLogged = false;
            this._restoreInProgress = false;
            this._paywallViewLogged = false;
            this._productRefreshLogged = false;
            this._lastRenderSignature = "";
            this._automaticProductRefreshAttempts = 0;
            this._nextAutomaticProductRefreshAt = 0;

            bind(".restore-purchases-btn", () => {
                SoundManager.playOk?.();
                this.startRestorePurchases();
            });
            bind(".account-btn", () => {
                SoundManager.playOk?.();
                if (!openWonderLangAccount()) {
                    this.showPurchaseFailure(
                        translatedValue("Paywall_AccountUnavailable", "Account sign-in is unavailable."),
                        translatedValue("Paywall_AccountUnavailableDesc", "Close this screen and update WonderLang before trying again.")
                    );
                }
            });

            clearNativePurchaseState();
            const syncStarted = refreshNativePurchases();
            this._initialEntitlementSyncPending = !!syncStarted && !this._entitlementSyncComplete;
            this._initialEntitlementSyncStartedAt = Date.now();
            if (!syncStarted && !hasNativePurchaseBridge()) {
                this._entitlementSyncComplete = true;
            }

            this.refreshStoreProducts();
            this.pollPaywallState();
            this._renderInterval = setInterval(() => this.pollPaywallState(), 750);
        }

        refreshStoreProducts() {
            this._productRefreshLogged = false;
            this._productRefreshStartedAt = Date.now();
            const started = refreshNativeProductDetails();
            if (!started) this._productRefreshStartedAt = Date.now() - 10000;
            this._lastRenderSignature = "";
            this.renderContent(true);
        }

        maybeAutomaticallyRefreshStoreProducts() {
            const priceState = this.currentPriceState();
            if (priceState === "ready") {
                this._automaticProductRefreshAttempts = 0;
                this._nextAutomaticProductRefreshAt = 0;
                return;
            }

            if (
                !isDeviceOnline() ||
                this._purchaseInFlight ||
                this._restoreInProgress
            ) {
                return;
            }

            const now = Date.now();
            const refreshAge = now - (this._productRefreshStartedAt || 0);
            if (refreshAge < 10000 || now < (this._nextAutomaticProductRefreshAt || 0)) return;

            const attempt = (this._automaticProductRefreshAttempts || 0) + 1;
            if (attempt > 3) return;
            this._automaticProductRefreshAttempts = attempt;
            this._nextAutomaticProductRefreshAt = now + [15000, 30000, 60000][attempt - 1];
            this.refreshStoreProducts();
        }

        currentOfferStructure() {
            const bundle = activeProducts().find(isBundleProduct);
            if (bundle && isProductPurchased(bundle.sku)) return "owned_full";
            return "monthly_plus_polyglot_permanent";
        }

        maybeLogPaywallView() {
            if (this._paywallViewLogged) return;
            this._paywallViewLogged = true;
            logAnalyticsEvent("paywall_view", {
                context: this._paywallContext || "unknown",
                offer_structure: this.currentOfferStructure(),
                price_state: this.currentPriceState(),
                entitlement_state: this._entitlementSyncComplete
                    ? "resolved"
                    : this._initialEntitlementSyncPending
                        ? "syncing"
                        : "unresolved"
            });
        }

        currentPriceState() {
            const visible = this.visibleProductsForReadiness();
            if (!visible.length) return "missing";

            const readyCount = visible.filter(product => {
                const state = getNativeProductDetailsState(product.sku);
                const price = getNativePriceDetails(product.sku, product.fallbackPrice);
                return price.live && (state === "READY" || state === "AVAILABLE" || state === "SUCCESS");
            }).length;
            if (readyCount === visible.length) return "ready";
            if (readyCount > 0) return "partial";

            const states = visible.map(product => getNativeProductDetailsState(product.sku));
            return states.some(state =>
                state === "LOADING" ||
                state === "QUERYING" ||
                state === "PENDING" ||
                state === "IDLE" ||
                state === "UNKNOWN" ||
                state === "UNINITIALIZED" ||
                state === "NOT_REQUESTED"
            ) ? "loading" : "missing";
        }

        visibleProductsForReadiness() {
            return activeProducts().slice();
        }

        maybeLogProductReadiness() {
            if (this._productRefreshLogged) return;
            const visible = this.visibleProductsForReadiness();
            if (!visible.length) return;

            const states = visible.map(product => getNativeProductDetailsState(product.sku));
            const readyCount = visible.filter((product, index) => {
                const state = states[index];
                const price = getNativePriceDetails(product.sku, product.fallbackPrice);
                return price.live && (state === "READY" || state === "AVAILABLE" || state === "SUCCESS");
            }).length;
            const stillLoading = states.some(state =>
                state === "LOADING" ||
                state === "QUERYING" ||
                state === "PENDING" ||
                state === "IDLE" ||
                state === "UNKNOWN" ||
                state === "UNINITIALIZED" ||
                state === "NOT_REQUESTED"
            );
            const waitedLongEnough = Date.now() - (this._productRefreshStartedAt || 0) >= 10000;
            if (stillLoading && !waitedLongEnough) return;

            this._productRefreshLogged = true;
            logAnalyticsEvent("store_products_result", {
                result: readyCount === visible.length ? "ready" : readyCount > 0 ? "partial" : "missing",
                ready_count: readyCount,
                missing_count: visible.length - readyCount,
                visible_count: visible.length,
                latency_ms: Math.max(0, Date.now() - (this._productRefreshStartedAt || Date.now()))
            });
        }

        directEntitlementSummary() {
            const bundle = activeProducts().find(isBundleProduct);
            const full = !!bundle && isProductPurchased(bundle.sku);
            const chapterCount = directChapterOwnership().count;
            return { full, chapterCount, any: full || chapterCount > 0 };
        }

        logEntitlementSync(source, result) {
            const summary = this.directEntitlementSummary();
            logAnalyticsEvent("entitlement_sync_result", {
                source,
                result,
                full_owned: summary.full,
                chapter_count: summary.chapterCount
            });
        }

        setRestoreButtonBusy(busy) {
            const button = this.$(".restore-purchases-btn");
            if (button) button.disabled = !!busy;
        }

        startRestorePurchases() {
            if (this._purchaseInFlight || this._restoreInProgress) {
                SoundManager.playBuzzer?.();
                return;
            }
            if (!isDeviceOnline()) {
                this.showPurchaseFailure(
                    tdb(tr("Paywall_Err_Offline")) || "You are offline.",
                    tdb(tr("Paywall_Err_ConnectToBuy")) || "Please connect to the internet to buy or restore purchases."
                );
                this.logEntitlementSync("manual_restore", "offline");
                return;
            }

            clearNativePurchaseState();
            this._restoreInProgress = true;
            this._restoreStartedAt = Date.now();
            this.setRestoreButtonBusy(true);
            this.setPurchaseModalText(
                tdb(tr("Paywall_Restoring")) || "Restoring purchases...",
                trFormat("Paywall_ConnectingStore", "Connecting to {STORE}...", { STORE: currentStoreName() })
            );
            this.$(".dl-modal")?.classList.remove("hidden");

            if (!refreshNativePurchases()) {
                this._restoreInProgress = false;
                this.setRestoreButtonBusy(false);
                this.logEntitlementSync("manual_restore", "start_error");
                this.showPurchaseFailure(
                    translatedValue("Paywall_Err_PurchaseBridge", "Purchases are temporarily unavailable."),
                    trFormat("Paywall_Err_PurchaseBridgeDesc", "Could not connect to {STORE}. Please close this screen and try again.", { STORE: currentStoreName() })
                );
                return;
            }
            this.pollPaywallState();
        }

        finishRestore(result) {
            this._restoreInProgress = false;
            this._entitlementSyncComplete = true;
            this.setRestoreButtonBusy(false);
            const summary = this.directEntitlementSummary();
            const found = summary.any;
            const pendingCount = getNativePendingPurchaseCount();
            const hasPending = pendingCount > 0;
            const title = found
                ? translatedValue("Paywall_RestoreComplete", "Purchases restored.")
                : hasPending
                    ? (tdb(tr("Paywall_PaymentPending")) || "Payment pending.")
                    : translatedValue("Paywall_RestoreNoPurchases", "No purchases were found.");
            const subtitle = hasPending
                ? trFormat(
                    "Paywall_PaymentPendingDesc",
                    "Your payment is still being processed by {STORE}. Access will unlock automatically after payment is confirmed.",
                    { STORE: currentStoreName() }
                )
                : "";
            this.setPurchaseModalText(title, subtitle);
            this.$(".dl-modal")?.classList.remove("hidden");
            this.logEntitlementSync("manual_restore", found ? "restored" : hasPending ? "pending" : "none");
            if (found) {
                logAnalyticsEvent("entitlement_granted", {
                    source: "restore",
                    entitlement: summary.full ? "full" : "chapters",
                    chapter_count: summary.chapterCount
                });
            }
            this._lastRenderSignature = "";
            this.renderContent(true);
        }

        failRestore(status) {
            this._restoreInProgress = false;
            this.setRestoreButtonBusy(false);
            this.logEntitlementSync("manual_restore", "error");
            this.showPurchaseFailure(
                trFormat("Paywall_Err_LoadFailed", "{STORE} could not restore purchases.", { STORE: currentStoreName() }),
                tdb(tr("Paywall_Err_CheckConnectionShort")) || "Please check your connection and try again."
            );
            console.warn(`[WonderLang Paywall] Restore failed with status ${status}.`);
        }

        pollPaywallState() {
            const status = getNativePurchaseStatus();

            if (this._initialEntitlementSyncPending) {
                if (status === "RESTORE_COMPLETE" || status === "PURCHASED") {
                    this._initialEntitlementSyncPending = false;
                    this._entitlementSyncComplete = true;
                    if (!this._initialEntitlementSyncLogged) {
                        this._initialEntitlementSyncLogged = true;
                        this.logEntitlementSync("paywall_open", this.directEntitlementSummary().any ? "found" : "none");
                    }
                } else if (status === "RESTORE_FAILED") {
                    this._initialEntitlementSyncPending = false;
                    if (!this._initialEntitlementSyncLogged) {
                        this._initialEntitlementSyncLogged = true;
                        this.logEntitlementSync("paywall_open", "error");
                    }
                } else if (Date.now() - this._initialEntitlementSyncStartedAt >= 60000) {
                    this._initialEntitlementSyncPending = false;
                    if (!this._initialEntitlementSyncLogged) {
                        this._initialEntitlementSyncLogged = true;
                        this.logEntitlementSync("paywall_open", "timeout");
                    }
                }
            }

            if (this._restoreInProgress) {
                if (status === "RESTORE_COMPLETE" || status === "PURCHASED") {
                    this.finishRestore(status);
                } else if (
                    status === "RESTORE_FAILED" ||
                    status === "OFFLINE" ||
                    status === "BILLING_NOT_READY" ||
                    status === "PURCHASE_BRIDGE_MISSING" ||
                    status === "IOS_BRIDGE_MISSING" ||
                    status === "SIGN_IN_REQUIRED" ||
                    status === "ACCOUNT_ERROR" ||
                    status === "VERIFICATION_FAILED"
                ) {
                    this.failRestore(status);
                } else if (Date.now() - this._restoreStartedAt >= 60000) {
                    this.failRestore("RESTORE_TIMEOUT");
                } else {
                    this.setPurchaseModalText(
                        status === "VERIFYING"
                            ? translatedValue("Paywall_VerifyingPurchase", "Verifying your purchase...")
                            : (tdb(tr("Paywall_Restoring")) || "Restoring purchases..."),
                        getNativePurchaseMessage() || trFormat("Paywall_ConnectingStore", "Connecting to {STORE}...", { STORE: currentStoreName() })
                    );
                }
            }

            this.maybeAutomaticallyRefreshStoreProducts();
            this.maybeLogPaywallView();
            this.maybeLogProductReadiness();
            this.renderContent();
        }

        renderContent(force = false) {
            const host = this.$("#store-content-area");
            if (!host) return;

            const products = activeProducts();
            const bundle = products.find(isBundleProduct);
            const monthly = products.find(isSubscriptionProduct);
            const chapters = orderedChapterProducts();
            const showChapterOffers = shouldShowChapterOffers(this._entitlementSyncComplete);
            const priceDetails = new Map(products.map(product => [
                normalizeSkuForPlatform(product.sku),
                getNativePriceDetails(product.sku, product.fallbackPrice)
            ]));
            const purchaseBridgeReady = hasNativePurchaseBridge() && isNativeBillingReady();
            const visibleProducts = products.slice();
            const renderSignature = JSON.stringify({
                context: this._paywallContext,
                syncComplete: this._entitlementSyncComplete,
                purchaseBridgeReady,
                offerStructure: this.currentOfferStructure(),
                products: visibleProducts.map(product => {
                    const sku = normalizeSkuForPlatform(product.sku);
                    const price = priceDetails.get(sku) || { text: "", live: false };
                    return {
                        sku,
                        owned: isProductPurchased(product.sku),
                        directOwned: isDirectProductPurchased(product.sku),
                        price: price.text,
                        live: price.live,
                        state: getNativeProductDetailsState(product.sku),
                        message: getNativeProductDetailsMessage(product.sku)
                    };
                })
            });
            if (!force && renderSignature === this._lastRenderSignature) return;
            this._lastRenderSignature = renderSignature;
            host.innerHTML = "";

            const t_bestValue = tdb(tr("Paywall_BestValue")) || "BEST VALUE";
            const t_unlockAll = tdb(tr("Paywall_UnlockAll")) || "Unlock All";
            const t_startTrial = translatedValue("Paywall_StartTrial", "Start 3-day free trial");
            const t_unlocked = tdb(tr("Paywall_Unlocked")) || "Unlocked";
            const t_buy = tdb(tr("Paywall_Buy")) || "Buy";
            const t_loadingPrice = translatedValue("Paywall_LoadingPrice", "Loading local price…");
            const t_productUnavailable = translatedValue("Paywall_Err_PurchaseBridge", "Purchases are temporarily unavailable.");
            const productStatusText = hasNativePurchaseBridge() ? t_loadingPrice : t_productUnavailable;

            if (this._paywallContext === "demoEnd") {
                const banner = document.createElement("div");
                banner.className = "demo-complete";
                banner.innerHTML = `
                    <div class="demo-complete-title">${translatedValue("Paywall_DemoComplete_Title", "Free adventure complete!")}</div>
                    <div class="demo-complete-body">${translatedValue("Paywall_DemoComplete_Body", "Your progress is saved. Continue immediately with a one-time purchase.")}</div>`;
                host.appendChild(banner);
            }

            if (monthly) {
                const monthlyPrice = priceDetails.get(normalizeSkuForPlatform(monthly.sku)) || { text: "", live: false };
                const isReady = isProductPurchased(monthly.sku);
                const canPurchase = !isReady && monthlyPrice.live && purchaseBridgeReady;
                const statusText = productDetailsStatusText(monthly, monthlyPrice);
                const btnHtml = isReady
                    ? `<button class="price-btn owned" disabled><span>${t_unlocked}</span></button>`
                    : canPurchase
                        ? `<button class="price-btn"><span>${t_startTrial}</span><span class="price-tag">${monthlyPrice.text}/month</span></button>`
                        : `<div class="price-loading">${statusText}</div>`;
                const accountNote = isAccountSignedIn()
                    ? translatedValue("Paywall_AccountReady", "Signed in — access and saves will follow you across platforms.")
                    : translatedValue("Paywall_SignInRequired", "A free WonderLang account is required so your purchase and saves can follow you.");
                const monthlyDiv = document.createElement("div");
                monthlyDiv.className = "hero-bundle monthly-offer";
                monthlyDiv.innerHTML = `
                    <div class="hero-ribbon">${translatedValue("Paywall_TrialRibbon", "3 DAYS FREE")}</div>
                    <div class="hero-info">
                        <div class="hero-title">${productDisplayName(monthly)}</div>
                        <div class="hero-desc">${productDisplayDescription(monthly)}</div>
                        <div class="hero-benefits">
                            <span class="hero-benefit">${translatedValue("Paywall_AllContent", "All chapters + all languages")}</span>
                            <span class="hero-benefit">${translatedValue("Paywall_CloudSaves", "Cross-platform cloud saves")}</span>
                            <span class="hero-benefit">${translatedValue("Paywall_CancelAnytime", "Cancel anytime")}</span>
                        </div>
                        <div class="hero-saving">${accountNote}</div>
                    </div>
                    <div class="hero-action">${btnHtml}</div>`;
                if (canPurchase) {
                    this.bindReleaseTap(monthlyDiv.querySelector(".price-btn"), () => {
                        SoundManager.playOk?.();
                        this.promptPurchase(monthly);
                    });
                }
                host.appendChild(monthlyDiv);
            }

            if (bundle) {
                const allChaptersOwned = chapters.length > 0 && chapters.every(chapter => isProductPurchased(chapter.sku));
                const isReady = isProductPurchased(bundle.sku) || allChaptersOwned;
                const bundlePrice = priceDetails.get(normalizeSkuForPlatform(bundle.sku)) || { text: "", live: false };
                const canPurchase = !isReady && bundlePrice.live && purchaseBridgeReady;
                const bundleStatusText = productDetailsStatusText(bundle, bundlePrice);
                const btnHtml = isReady
                    ? `<button class="price-btn owned" disabled><span>${t_unlocked}</span></button>`
                    : canPurchase
                        ? `<button class="price-btn"><span style="margin-right:15px;">${t_unlockAll}</span><span class="price-tag">${bundlePrice.text}</span></button>`
                        : `<div class="price-loading">${bundleStatusText}</div>`;

                const chapterPriceTexts = chapters.map(chapter => priceDetails.get(normalizeSkuForPlatform(chapter.sku))?.text || "");
                const saving = showChapterOffers && bundlePrice.live && chapterPriceTexts.every(Boolean)
                    ? localizedSavings(bundlePrice.text, chapterPriceTexts)
                    : null;
                const savingHtml = saving
                    ? `<div class="hero-saving">${trFormat("Paywall_SaveAmount", "Save {SAVING} ({PERCENT}%) compared with buying four chapters separately.", { SAVING: saving.amount, PERCENT: saving.percent })}</div>`
                    : "";

                const heroDiv = document.createElement('div');
                heroDiv.className = "hero-bundle";
                heroDiv.innerHTML = `
                    <div class="hero-ribbon">${t_bestValue}</div>
                    <div class="hero-info">
                        <div class="hero-title">${productDisplayName(bundle)}</div>
                        <div class="hero-desc">${productDisplayDescription(bundle)}</div>
                        <div class="hero-benefits">
                            <span class="hero-benefit">${translatedValue("Paywall_OneTimePurchase", "One-time permanent purchase")}</span>
                            <span class="hero-benefit">${translatedValue("Paywall_OneMobilePlatform", "Full game on this mobile platform")}</span>
                            <span class="hero-benefit">${translatedValue("Paywall_NoCloudSaves", "Cloud save not included")}</span>
                            <span class="hero-benefit">${translatedValue("Paywall_ProgressImmediate", "Your progress is saved. Continue immediately.")}</span>
                        </div>
                        ${savingHtml}
                    </div>
                    <div class="hero-action">${btnHtml}</div>
                `;

                if (canPurchase) {
                    const btn = heroDiv.querySelector('.price-btn');
                    this.bindReleaseTap(btn, () => {
                        SoundManager.playOk?.();
                        this.promptPurchase(bundle);
                    });
                }
                host.appendChild(heroDiv);
            }

            if (showChapterOffers && chapters.length > 0) {
                const gridDiv = document.createElement('div');
                gridDiv.className = "chapters-grid";
                const bundleOwned = !!bundle && isDirectProductPurchased(bundle.sku);

                chapters.forEach(chapter => {
                    const chapterPrice = priceDetails.get(normalizeSkuForPlatform(chapter.sku)) || { text: "", live: false };
                    const chapterStatusText = productDetailsStatusText(chapter, chapterPrice);
                    const isReady = bundleOwned || isProductPurchased(chapter.sku);
                    const canPurchase = !isReady && chapterPrice.live && purchaseBridgeReady;
                    const btnHtml = isReady
                        ? `<button class="price-btn owned" disabled><span>${t_unlocked}</span></button>`
                        : canPurchase
                            ? `<button class="price-btn"><span>${t_buy}</span><span class="price-tag">${chapterPrice.text}</span></button>`
                            : `<div class="price-loading">${chapterStatusText}</div>`;

                    const cardDiv = document.createElement('div');
                    cardDiv.className = "chapter-card";
                    cardDiv.innerHTML = `
                        <div class="chapter-copy">
                            <div class="chapter-title">${productDisplayName(chapter)}</div>
                            <div class="chapter-desc">${productDisplayDescription(chapter)}</div>
                        </div>
                        ${btnHtml}`;

                    if (canPurchase) {
                        this.bindReleaseTap(cardDiv.querySelector('.price-btn'), () => {
                            SoundManager.playOk?.();
                            this.promptPurchase(chapter);
                        });
                    }
                    gridDiv.appendChild(cardDiv);
                });
                host.appendChild(gridDiv);
            }
        }

        promptPurchase(product) {
            if (this._purchaseInFlight || this._restoreInProgress) {
                SoundManager.playBuzzer?.();
                return;
            }
            this._activeItem = product;
            this._checkoutLoggedResults = new Set();
            logAnalyticsEvent("select_item", {
                item_id: normalizeSkuForPlatform(product?.sku),
                item_type: productAnalyticsType(product),
                offer_structure: this.currentOfferStructure(),
                context: this._paywallContext || "unknown"
            });
            this.executePurchase();
        }

        setPurchaseModalText(title, subtitle) {
            const titleEl = this.$("#paywall-status-text");
            const subEl = this.$("#paywall-status-subtext");
            if (titleEl) titleEl.innerHTML = title;
            if (subEl) subEl.innerHTML = subtitle || "";
        }

        showPurchaseFailure(title, subtitle) {
            this._purchaseInFlight = false;
            if (this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
            this.setPurchaseModalText(title, subtitle);
            this.$(".dl-modal")?.classList.remove("hidden");
        }

        onDownloadModalClose() {
            // Hiding an active checkout must not stop entitlement polling or leave
            // the paywall permanently locked in _purchaseInFlight.
            if (!this._purchaseInFlight && !this._restoreInProgress && this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
            this.$(".dl-modal")?.classList.add("hidden");
        }

        logCheckoutResult(result, status) {
            if (!this._checkoutLoggedResults) this._checkoutLoggedResults = new Set();
            const key = `${result}:${status || ""}`;
            if (this._checkoutLoggedResults.has(key)) return;
            this._checkoutLoggedResults.add(key);
            logAnalyticsEvent("iap_checkout_result", {
                result,
                status: status || "unknown",
                item_id: normalizeSkuForPlatform(this._activeItem?.sku),
                item_type: isBundleProduct(this._activeItem) ? "full" : "chapter"
            });
        }

        executePurchase() {
            this.$(".confirm-modal")?.classList.add("hidden");

            if (this._purchaseInFlight || this._restoreInProgress) {
                SoundManager.playBuzzer?.();
                return;
            }

            // Reset native Billing response telemetry before validating this attempt so
            // JavaScript-only failures cannot inherit a previous checkout's response code.
            clearNativePurchaseState();

            if (!this._activeItem || !this._activeItem.sku) {
                this.logCheckoutResult("error", "missing_sku");
                this.showPurchaseFailure(
                    tdb(tr("Paywall_Err_CannotPurchase")) || "This product cannot be purchased.",
                    tdb(tr("Paywall_Err_IDMissing")) || "The product ID is missing. Please close this screen and try again."
                );
                return;
            }

            if (!isDeviceOnline()) {
                this.logCheckoutResult("error", "offline");
                this.showPurchaseFailure(
                    tdb(tr("Paywall_Err_Offline")) || "You are offline.",
                    tdb(tr("Paywall_Err_ConnectToBuy")) || "Please connect to the internet to buy or restore purchases."
                );
                return;
            }

            if (hasAndroidBillingBridge() && !isNativeBillingReady()) {
                this.logCheckoutResult("error", "billing_not_ready");
                this.showPurchaseFailure(
                    tdb(trFormat("Paywall_Err_StoreNotReady", "{STORE} is not ready yet.", { STORE: currentStoreName() })),
                    tdb(tr("Paywall_Err_CheckConnection")) || "Please check your connection, wait a moment, and try again."
                );
                return;
            }

            const price = getNativePriceDetails(this._activeItem.sku, this._activeItem.fallbackPrice);
            if (!price.live) {
                this.logCheckoutResult("error", "product_not_ready");
                this.refreshStoreProducts();
                this.showPurchaseFailure(
                    trFormat("Paywall_Err_LoadFailed", "{STORE} could not load this product.", { STORE: currentStoreName() }),
                    tdb(tr("Paywall_Err_CheckConnectionShort")) || "Please check your connection and try again."
                );
                return;
            }

            this._purchaseInFlight = true;
            this._checkoutLoggedResults = new Set();
            logAnalyticsEvent("begin_checkout", {
                item_id: normalizeSkuForPlatform(this._activeItem.sku),
                item_type: productAnalyticsType(this._activeItem),
                offer_structure: this.currentOfferStructure(),
                context: this._paywallContext || "unknown"
            });
            this.setPurchaseModalText(
                trFormat("Paywall_ConnectingStore", "Connecting to {STORE}...", { STORE: currentStoreName() }),
                tdb(trFormat("Paywall_LoadingDetails", "Loading product details from {STORE}...", { STORE: currentStoreName() }))
            );
            this.$(".dl-modal").classList.remove("hidden");

            const startResult = startNativePurchase(this._activeItem.sku);

            if (startResult === "OFFLINE") {
                this.logCheckoutResult("error", startResult);
                this.showPurchaseFailure(
                    tdb(tr("Paywall_Err_Offline")) || "You are offline.",
                    tdb(tr("Paywall_Err_ConnectToBuy")) || "Please connect to the internet to buy or restore purchases."
                );
                return;
            }

            if (startResult === "BILLING_NOT_READY") {
                this.logCheckoutResult("error", startResult);
                this.showPurchaseFailure(
                    tdb(trFormat("Paywall_Err_StoreNotReady", "{STORE} is not ready yet.", { STORE: currentStoreName() })),
                    tdb(tr("Paywall_Err_CheckConnection")) || "Please check your connection, wait a moment, and try again."
                );
                return;
            }

            if (startResult === "INVALID_SKU") {
                this.logCheckoutResult("error", startResult);
                this.showPurchaseFailure(
                    tdb(tr("Paywall_Err_CannotPurchase")) || "This product cannot be purchased.",
                    tdb(tr("Paywall_Err_InvalidSKU")) || "The product ID is missing or invalid."
                );
                return;
            }

            if (startResult === "SIGN_IN_REQUIRED") {
                this.logCheckoutResult("account_required", startResult);
                this.showPurchaseFailure(
                    translatedValue("Paywall_SignInRequiredTitle", "Sign in to continue."),
                    translatedValue("Paywall_SignInRequired", "A free WonderLang account is required so your purchase and saves can follow you.")
                );
                return;
            }

            if (startResult === "IOS_BRIDGE_MISSING" || startResult === "PURCHASE_BRIDGE_MISSING") {
                this.logCheckoutResult("error", startResult);
                this.showPurchaseFailure(
                    translatedValue("Paywall_Err_PurchaseBridge", "Purchases are temporarily unavailable."),
                    trFormat("Paywall_Err_PurchaseBridgeDesc", "Could not connect to {STORE}. Please close this screen and try again.", { STORE: currentStoreName() })
                );
                return;
            }

            if (startResult === "FLOW_LAUNCHED") {
                this.logCheckoutResult("launched", startResult);
            }

            if (this._pollInterval) clearInterval(this._pollInterval);

            let ticks = 0;
            const maxTicks = 75;

            this._pollInterval = setInterval(() => {
                ticks++;

                if (!isDeviceOnline()) {
                    this.logCheckoutResult("error", "offline");
                    this.showPurchaseFailure(
                        tdb(tr("Paywall_Err_Offline")) || "You are offline.",
                        tdb(tr("Downloader_Err_Offline_General")) || "Please connect to the internet and try again."
                    );
                    return;
                }

                if (ticks === 1 || ticks % 3 === 0) syncNativePurchases();

                if (isProductPurchased(this._activeItem.sku)) {
                    clearInterval(this._pollInterval);
                    this._pollInterval = null;
                    this.onSuccess();
                    return;
                }

                const status = getNativePurchaseStatus();
                const message = getNativePurchaseMessage();

                if (status === "ACCOUNT_SYNCING") {
                    this.setPurchaseModalText(
                        translatedValue("Paywall_PreparingAccount", "Preparing your WonderLang account..."),
                        message || translatedValue("Paywall_AccountSecurity", "Your account links this purchase securely across platforms.")
                    );
                    return;
                }

                if (status === "QUERYING") {
                    this.setPurchaseModalText(
                        trFormat("Paywall_ConnectingStore", "Connecting to {STORE}...", { STORE: currentStoreName() }),
                        message || tdb(trFormat("Paywall_LoadingDetails", "Loading product details from {STORE}...", { STORE: currentStoreName() }))
                    );
                    return;
                }

                if (status === "FLOW_LAUNCHED") {
                    this.logCheckoutResult("launched", status);
                    this.setPurchaseModalText(
                        tdb(trFormat("Paywall_StoreOpened", "{STORE} purchase opened.", { STORE: currentStoreName() })),
                        message || tdb(tr("Paywall_Warning")) || "Please complete the transaction on your screen."
                    );
                    return;
                }

                if (status === "ITEM_ALREADY_OWNED") {
                    this.setPurchaseModalText(
                        tdb(tr("Paywall_Restoring")) || "Restoring purchase...",
                        tdb(trFormat("Paywall_AlreadyOwned", "{STORE} says this item is already owned. Please wait.", { STORE: currentStoreName() }))
                    );
                    return;
                }

                if (status === "VERIFYING") {
                    this.setPurchaseModalText(
                        translatedValue("Paywall_VerifyingPurchase", "Verifying your purchase..."),
                        message || translatedValue("Paywall_VerifyingPurchaseDesc", "Google Play completed the payment. WonderLang is securely confirming access.")
                    );
                    return;
                }

                if (status === "SIGN_IN_REQUIRED") {
                    this.logCheckoutResult("account_required", status);
                    this.showPurchaseFailure(
                        translatedValue("Paywall_SignInRequiredTitle", "Sign in to continue."),
                        message || translatedValue("Paywall_SignInRequired", "A free WonderLang account is required so your purchase and saves can follow you.")
                    );
                    return;
                }

                if (status === "PENDING") {
                    this.logCheckoutResult("pending", status);
                    this.showPurchaseFailure(
                        tdb(tr("Paywall_PaymentPending")) || "Payment pending.",
                        tdb(trFormat(
                            "Paywall_PaymentPendingDesc",
                            "Your payment is still being processed by {STORE}. Close this message; access will unlock automatically after payment is confirmed.",
                            { STORE: currentStoreName() }
                        ))
                    );
                    return;
                }

                if (status === "CANCELED") {
                    this.logCheckoutResult("canceled", status);
                    this.showPurchaseFailure(
                        tdb(tr("Paywall_Canceled")) || "Purchase canceled.",
                        tdb(tr("Paywall_NoPurchase")) || "No purchase was completed."
                    );
                    return;
                }

                if (status === "OFFLINE") {
                    this.logCheckoutResult("error", status);
                    this.showPurchaseFailure(
                        tdb(tr("Paywall_Err_Offline")) || "You are offline.",
                        message || tdb(tr("Paywall_Err_ConnectToBuy")) || "Please connect to the internet to buy or restore purchases."
                    );
                    return;
                }

                if (status === "BILLING_NOT_READY") {
                    this.logCheckoutResult("error", status);
                    this.showPurchaseFailure(
                        tdb(trFormat("Paywall_Err_StoreNotReady", "{STORE} is not ready yet.", { STORE: currentStoreName() })),
                        message || tdb(tr("Paywall_Err_CheckConnectionShort")) || "Please check your connection and try again."
                    );
                    return;
                }

                if (status === "IOS_BRIDGE_MISSING" || status === "PURCHASE_BRIDGE_MISSING") {
                    this.logCheckoutResult("error", status);
                    this.showPurchaseFailure(
                        translatedValue("Paywall_Err_PurchaseBridge", "Purchases are temporarily unavailable."),
                        message || trFormat("Paywall_Err_PurchaseBridgeDesc", "Could not connect to {STORE}. Please close this screen and try again.", { STORE: currentStoreName() })
                    );
                    return;
                }

                if (
                    status.startsWith("PRODUCT_QUERY_FAILED") ||
                    status.startsWith("LAUNCH_FAILED") ||
                    status.startsWith("FAILED") ||
                    status === "PRODUCT_NOT_FOUND" ||
                    status === "ACCOUNT_ERROR" ||
                    status === "VERIFICATION_FAILED"
                ) {
                    this.logCheckoutResult("error", status);
                    this.showPurchaseFailure(
                        tdb(trFormat("Paywall_Err_LoadFailed", "{STORE} could not load this product.", { STORE: currentStoreName() })),
                        message || tdb(tr("Paywall_Err_CheckConnectionShort")) || "Please check your connection and try again."
                    );
                    return;
                }

                if (ticks >= maxTicks) {
                    this.logCheckoutResult("error", "timeout");
                    this.showPurchaseFailure(
                        tdb(trFormat("Paywall_Err_PurchaseUnfinished", "{STORE} did not finish the purchase.", { STORE: currentStoreName() })),
                        tdb(tr("Paywall_Err_CloseAndTry")) || "Please close this message, check your connection, and try again."
                    );
                }
            }, 1000);
        }

        onSuccess() {
            this._purchaseInFlight = false;
            this.logCheckoutResult("success", "purchased");
            logAnalyticsEvent("entitlement_granted", {
                source: "checkout",
                entitlement: productAnalyticsType(this._activeItem),
                item_id: normalizeSkuForPlatform(this._activeItem?.sku)
            });
            this.logEntitlementSync("checkout", "granted");
            if (this._pollInterval) {
                clearInterval(this._pollInterval);
                this._pollInterval = null;
            }
            this.$(".dl-modal").classList.add("hidden");
            AudioManager.playSe({ name: "Chime2", pan: 0, pitch: 100, volume: 90 });
            this.$(".success-modal").classList.remove("hidden");
            this._lastRenderSignature = "";
            this.renderContent(true);
        }

        onSuccessButtonPressed() {
            this.$(".success-modal")?.classList.add("hidden");
            syncNativePurchases();
            this._paywallCloseReason = "purchase_success";
            this.logPaywallClose("purchase_success");
            SceneManager.pop();
        }
    }

    // ------------- Plugin Commands -------------

    function canRunNativePluginCommand() {
        if (FORCE_ANDROID || FORCE_IOS) return true;

        // Real Android build: keep the existing Android behavior.
        if (typeof window.AndroidManager !== "undefined") return true;

        // Real iOS build: allow the same plugin commands through the iOS bridge / WKWebView runtime.
        if (isIOSRuntime()) return true;

        // Extra safety: allow Android even if the bridge is not ready yet.
        const ua = String(navigator.userAgent || navigator.vendor || "");
        return /Android/i.test(ua);
    }

    function hasAndroidReviewBridge(methodName) {
        return typeof window.AndroidManager !== "undefined" &&
            typeof window.AndroidManager[methodName] === "function";
    }

    function currentGamePlaytimeHours() {
        try {
            if ($gameSystem && typeof $gameSystem.playtime === "function") {
                return Number($gameSystem.playtime() || 0) / 3600;
            }
        } catch (_) {}
        return null;
    }

    const ANDROID_PAYWALL_SCRIPT_CONDITION = "/Android/i.test(navigator.userAgent)";

    function isPaywallCommand(command) {
        if (!command || command.code !== 357 || !Array.isArray(command.parameters)) return false;
        return command.parameters[0] === pluginName &&
            (command.parameters[1] === "openPaywall" || command.parameters[1] === "promptPaywall");
    }

    function currentBranchContainsPaywallCommand(interpreter) {
        const list = interpreter?._list;
        if (!Array.isArray(list)) return false;

        const currentIndex = Number(interpreter._index || 0);
        const currentIndent = Number(interpreter._indent || 0);

        for (let i = currentIndex + 1; i < list.length; i++) {
            const command = list[i];
            if (!command) continue;
            if (Number(command.indent || 0) <= currentIndent) break;
            if (isPaywallCommand(command)) return true;
        }

        return false;
    }

    const _WL_PAD_Game_Interpreter_command111 = Game_Interpreter.prototype.command111;
    Game_Interpreter.prototype.command111 = function(params) {
        const isAndroidPaywallCheck = Array.isArray(params) &&
            params[0] === 12 &&
            String(params[1] || "").trim() === ANDROID_PAYWALL_SCRIPT_CONDITION;

        if (isAndroidPaywallCheck && isIOSRuntime() && currentBranchContainsPaywallCommand(this)) {
            this._branch[this._indent] = true;
            return true;
        }

        return _WL_PAD_Game_Interpreter_command111.call(this, params);
    };

    PluginManager.registerCommand(pluginName, "openDownloader", () => {
        if (!canRunNativePluginCommand()) {
            console.info(`[WonderLang PAD] Ignored plugin command "openDownloader" because this is not Android/iOS and Force Android/iOS Mode is OFF.`);
            return;
        }

        SceneManager.push(Scene_AssetDownloader);
    });

    PluginManager.registerCommand(pluginName, "openPaywall", function(args) {
        if (!canRunNativePluginCommand()) {
            console.info(`[WonderLang PAD] Ignored plugin command "openPaywall" because this is not Android/iOS and Force Android/iOS Mode is OFF.`);
            return;
        }

        SceneManager.push(Scene_Paywall);
        SceneManager.prepareNextScene(String(args?.context || ""));
    });

    PluginManager.registerCommand(pluginName, "promptPaywall", function() {
        if (!canRunNativePluginCommand()) {
            console.info(`[WonderLang PAD] Ignored plugin command "promptPaywall" because this is not Android/iOS and Force Android/iOS Mode is OFF.`);
            return;
        }

        SceneManager.push(Scene_Paywall);
        SceneManager.prepareNextScene("softGate");
    });

    PluginManager.registerCommand(pluginName, "requestAndroidInAppReview", args => {
        if (!hasAndroidReviewBridge("requestInAppReview")) {
            console.info('[WonderLang PAD] Ignored "requestAndroidInAppReview" because this is not the native Android app.');
            return;
        }

        const minimumHours = Math.max(0, Number(args?.minimumHours ?? 5) || 0);
        const playtimeHours = currentGamePlaytimeHours();
        if (playtimeHours === null || playtimeHours < minimumHours) {
            console.info(`[WonderLang PAD] Android review request skipped: ${playtimeHours ?? "unknown"} / ${minimumHours} hours.`);
            return;
        }

        try {
            const result = String(window.AndroidManager.requestInAppReview() || "STARTED");
            console.info(`[WonderLang PAD] Android in-app review request: ${result}.`);
        } catch (e) {
            console.warn("[WonderLang PAD] Android in-app review request failed.", e);
        }
    });

    PluginManager.registerCommand(pluginName, "openAndroidPlayStoreReviewPage", () => {
        if (!hasAndroidReviewBridge("openPlayStoreReviewPage")) {
            console.info('[WonderLang PAD] Ignored "openAndroidPlayStoreReviewPage" because this is not the native Android app.');
            return;
        }

        try {
            window.AndroidManager.openPlayStoreReviewPage();
        } catch (e) {
            console.warn("[WonderLang PAD] Could not open the Android Play Store review page.", e);
        }
    });

    PluginManager.registerCommand(pluginName, "checkPacksOnLoad", function(args) {
        if (!canRunNativePluginCommand()) {
            console.info(`[WonderLang PAD] Ignored plugin command "checkPacksOnLoad" because this is not Android/iOS and Force Android/iOS Mode is OFF.`);
            return;
        }

        console.log("Checking packs for language variable ID:", args.langVar);

        const langVar = Number(args.langVar) || 0;
        let missingLangName = null;
        let needsDownload = false;
        const cfg = activeConfig();

        let langCode = "";
        if (langVar > 0) {
            langCode = normalizePackCode($gameVariables.value(langVar));
            if (langCode === "0") langCode = "";
        }

        console.log("Detected Language Code:", langCode || "NONE");
        console.log("Active asset platform:", cfg.platform);
        console.log("Built-in packs:", Array.from(cfg.builtInPackCodes).join(", "));
        console.log("Downloadable packs:", Array.from(cfg.downloadablePackCodes).join(", "));

        if (langCode !== "") {
            if (isBuiltInPackCode(langCode)) {
                console.log(`Pack [${langCode}] is built in. No download needed.`);
                return;
            }

            if (!isDownloadablePackCode(langCode)) {
                console.error(
                    `[WonderLang PAD] Unsupported language code [${langCode}] detected. ` +
                    `Allowed optional packs: ${Array.from(cfg.downloadablePackCodes).join(", ")}.`
                );
                return;
            }
            if (!isPackInstalled(langCode)) {
                console.log(`Pack [${langCode}] is missing. Triggering downloader UI.`);
                needsDownload = true;
                const packDef = cfg.packs.find(p => normalizePackCode(p.code) === langCode);
                missingLangName = packDef ? (tdb(packDef.text) || langCode.toUpperCase()) : langCode.toUpperCase();
            } else {
                console.log(`Pack [${langCode}] found locally.`);
            }
        } else {
            const builtInAvailable = Array.from(cfg.builtInPackCodes).some(code => isPackInstalled(code));
            const anyInstalled = builtInAvailable || cfg.packs.some(p => isPackInstalled(p.code));
            if (!anyInstalled) {
                console.log("No packs installed. Triggering downloader UI.");
                needsDownload = true;
            } else {
                console.log("At least one language is already available. No downloader needed.");
            }
        }

        if (needsDownload) {
            SceneManager.push(Scene_AssetDownloader);
            SceneManager.prepareNextScene(missingLangName, true);
        }
    });

})();
