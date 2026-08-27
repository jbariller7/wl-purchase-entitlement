package com.wonderlang.app

import androidx.activity.result.contract.ActivityResultContracts
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognitionSupport
import android.speech.RecognitionSupportCallback
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.view.ViewGroup
import android.webkit.*
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import com.wonderlang.app.R
import com.facebook.FacebookSdk
import com.facebook.appevents.AppEventsConstants
import com.facebook.appevents.AppEventsLogger
import com.google.android.play.core.assetpacks.AssetPackManager
import com.google.android.play.core.assetpacks.AssetPackManagerFactory
import com.google.android.play.core.assetpacks.AssetPackStateUpdateListener
import com.google.android.play.core.assetpacks.model.AssetPackStatus
import com.google.android.play.core.assetpacks.model.AssetPackErrorCode
import com.google.android.play.core.review.ReviewManagerFactory
import com.google.firebase.analytics.FirebaseAnalytics
import java.io.File
import java.math.BigDecimal
import java.security.MessageDigest
import java.util.Currency
import java.util.Locale
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.TimeUnit
import com.android.billingclient.api.*
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var accountManager: WonderLangAccountManager
    private lateinit var assetPackManager: AssetPackManager
    private lateinit var assetLoader: WebViewAssetLoader
    private lateinit var progressBar: ProgressBar
    private lateinit var statusText: TextView
    private lateinit var loadingOverlay: LinearLayout
    // --- NEW: For Save Backups ---
    private var pendingExportData: String? = null
    private var speechRecognizer: SpeechRecognizer? = null
    private var speechCallbackName: String = "__ShoraAndroidSpeechResult"
    @Volatile private var lastSpeechStatusJson: String = ""

    private val exportLauncher = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        if (uri != null && pendingExportData != null) {
            try {
                contentResolver.openOutputStream(uri)?.use { stream ->
                    stream.write(pendingExportData!!.toByteArray())
                }
                updateStatus("✅ Backup Exported!")
            } catch (e: Exception) {
                Log.e(TAG, "Export failed", e)
            }
        }
        pendingExportData = null
    }

    private val importLauncher = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            try {
                val text = contentResolver.openInputStream(uri)?.bufferedReader().use { it?.readText() } ?: ""
                // Encode to Base64 to safely pass the string through the Javascript bridge
                val b64 = android.util.Base64.encodeToString(text.toByteArray(), android.util.Base64.NO_WRAP)
                webView.post { webView.evaluateJavascript("window.WL_ImportData('$b64');", null) }
            } catch (e: Exception) {
                Log.e(TAG, "Import failed", e)
                webView.post { webView.evaluateJavascript("window.WL_ImportCancel();", null) }
            }
        } else {
            // User cancelled the file picker
            webView.post { webView.evaluateJavascript("window.WL_ImportCancel();", null) }
        }
    }
    private val TAG = "WonderLang"
    private val DIAGNOSTICS_PREFS = "wl_diagnostics"
    private val ENGINE_BOOT_IN_PROGRESS = "in_progress"
    private val ENGINE_BOOT_FAILED = "failed"
    private val ENGINE_BOOT_SUCCEEDED = "succeeded"
    private val ANALYTICS_NAME_PATTERN = Regex("^[A-Za-z][A-Za-z0-9_]{0,39}$")
    private val ANALYTICS_RESERVED_PREFIXES = listOf("firebase_", "google_", "ga_")
    private val ANALYTICS_ALLOWED_BRIDGE_EVENTS = setOf(
        "language_pack_view",
        "language_pack_start",
        "language_pack_result",
        "tutorial_begin",
        "tutorial_complete",
        "progress_checkpoint",
        "demo_end",
        "paywall_view",
        "paywall_close",
        "store_products_result",
        "select_item",
        "begin_checkout",
        "iap_checkout_result",
        "entitlement_sync_result",
        "entitlement_granted"
    )
    private val ANALYTICS_ALLOWED_SCREEN_NAMES = setOf(
        "title",
        "language_select",
        "language_download",
        "tutorial",
        "gameplay",
        "demo_end",
        "paywall"
    )
    private val ANALYTICS_COMMERCE_CONTEXT_KEYS = setOf(
        "context",
        "offer_structure",
        "target_language",
        "base_language",
        "language_level",
        "playtime_bucket",
        "access_tier"
    )
    private val ANALYTICS_HIGH_CARDINALITY_KEYS = setOf(
        "userid",
        "deviceid",
        "installid",
        "sessionid",
        "eventid",
        "receipt",
        "signature",
        "message",
        "errormessage",
        "debugmessage",
        "exception",
        "stacktrace",
        "email",
        "phone",
        "fullname"
    )
    private val GOOGLE_PLAY_ORDER_ID_PATTERN =
        Regex("(?i)^GPA\\.[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{5}(?:\\.\\.[0-9]+)?$")
    private val MAX_ANALYTICS_PARAMS = 25
    private val MAX_ANALYTICS_STRING_LENGTH = 100
    private val MAX_ANALYTICS_PARAMS_JSON_LENGTH = 8_192
    private val ANALYTICS_CODE_UNSET = Int.MIN_VALUE

    private val PACK_GAME = "game"
    private val PACK_FR = "fr"
    private val PACK_ES = "es"
    private val PACK_DE = "de"
    private val PACK_PT = "pt"
    private val PACK_IT = "it"
    private val PACK_KR = "kr"
    private val PACK_JP = "jp"
    private val PACK_ZH = "zh"
    private val PACK_EN = "en"
    private val PACK_US = "us"
    private val PACK_AR = "ar"

    // Only the core game is install-time. All language packs are optional Play Asset Delivery packs.
    // FR, ES, DE, PT, IT, KR, JP, ZH, EN, US, and AR are downloaded on demand.
    private val INSTALL_TIME_PACKS = setOf(PACK_GAME)
    private val STARTUP_PACKS = listOf(PACK_GAME)
    private val RUNTIME_FETCH_PACKS = setOf(PACK_FR, PACK_ES, PACK_DE, PACK_PT, PACK_IT, PACK_KR, PACK_JP, PACK_ZH, PACK_EN, PACK_US, PACK_AR)
    private val BUILT_IN_LANGUAGE_ALIASES = emptySet<String>()
    private val NEVER_FETCH_PACKS = INSTALL_TIME_PACKS
    private val ALL_KNOWN_LANGUAGE_PACKS = RUNTIME_FETCH_PACKS
    private var packCheckRetries = 0
    private val MAX_RETRIES = 5
    private var isGameLoaded = false
    @Volatile private var activityStartedAtElapsedMs: Long = 0L
    @Volatile private var activityWasColdStart: Boolean = true
    @Volatile private var trustedGamePageVisible: Boolean = false
    @Volatile private var gameContentReadyLogged: Boolean = false
    private lateinit var billingClient: BillingClient
    private val purchasedProducts = ConcurrentHashMap.newKeySet<String>()
    private val historicalFullUpgradeProducts = ConcurrentHashMap.newKeySet<String>()
    private val pendingProducts = ConcurrentHashMap.newKeySet<String>()
    @Volatile private var productPrices: Map<String, String> = emptyMap()
    @Volatile private var subscriptionOfferTokens: Map<String, String> = emptyMap()
    private val purchaseClaimsInFlight = ConcurrentHashMap.newKeySet<String>()
    private data class StoreProductPrice(
        val amountMicros: Long,
        val currencyCode: String,
        val hasThreeDayTrial: Boolean = false
    )
    @Volatile private var storeProductPrices: Map<String, StoreProductPrice> = emptyMap()
    private enum class ProductDetailsState {
        IDLE,
        LOADING,
        READY,
        UNAVAILABLE,
        ERROR,
        BILLING_NOT_READY
    }
    private enum class PurchaseHandlingResult { PURCHASED, VERIFYING, PENDING, SIGN_IN_REQUIRED, IGNORED }
    private lateinit var firebaseAnalytics: FirebaseAnalytics
    private lateinit var metaAppEventsLogger: AppEventsLogger
    @Volatile private var metaTrackingEnabled = false
    @Volatile private var reviewFlowInProgress = false
    @Volatile private var lastPurchaseStatus: String = "IDLE"
    @Volatile private var lastPurchaseMessage: String = ""
    // Historical one-time SKUs remain queryable/restorable. Only wonderlangfull is
    // offered for new one-time purchases; chapter SKUs are restore-only.
    private val IN_APP_SKUS = setOf("wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4", "wonderlangfull")
    private val SUBS_SKUS = setOf("wonderlangmonthly")
    private val ALL_STORE_SKUS = IN_APP_SKUS + SUBS_SKUS
    private val CHAPTER_SKUS = setOf("wonderlangch1", "wonderlangch2", "wonderlangch3", "wonderlangch4")
    // The legacy-compatible `buy` option remains active for already-released app
    // versions. This build must select the staged USD 31.99 Polyglot option by ID.
    private val POLYGLOT_PURCHASE_OPTION_ID = "buy-polyglot-permanent"
    // Must match LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF in the entitlement service.
    private val LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF_MS = 1_787_615_999_999L
    private val ACCOUNT_API_BASE_URL = "https://wl-purchase-entitlement.netlify.app"
    private val purchaseQueryLock = Any()
    @Volatile private var purchaseQueryInFlight: Boolean = false
    @Volatile private var purchaseEntitlementSyncCompleted: Boolean = false
    private var purchaseQueryGeneration: Long = 0L
    private val productDetailsLock = Any()
    @Volatile private var productDetailsStates: Map<String, ProductDetailsState> = emptyMap()
    @Volatile private var productDetailsMessages: Map<String, String> = emptyMap()
    @Volatile private var productDetailsRefreshInFlight: Boolean = false
    private var productDetailsQueryGeneration: Long = 0L
    @Volatile private var lastProductDetailsResponseCode: Int = ANALYTICS_CODE_UNSET
    @Volatile private var lastProductDetailsSubResponseCode: Int = ANALYTICS_CODE_UNSET
    @Volatile private var lastProductDetailsLatencyMs: Long = -1L
    @Volatile private var lastBillingResponseCode: Int = ANALYTICS_CODE_UNSET
    @Volatile private var lastBillingSubResponseCode: Int = ANALYTICS_CODE_UNSET
    // Track PAD state for the install-time game pack
    private val packProgress = mutableMapOf<String, Int>()
    private val packSizes = ConcurrentHashMap<String, Pair<Long, Long>>() // downloaded, total

    // PAD state tracking for the install-time game pack.
    private val packStatuses = mutableMapOf<String, Int>()
    private val packErrors = mutableMapOf<String, Int>()
    private val activePackDownloads = mutableSetOf<String>()

    private fun installCrashDiagnosticsHandler() {
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()

        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                val diagnostic = buildPadDiagnosticMessage(
                    title = "💥 Previous app crash detected.",
                    code = "UNCAUGHT_EXCEPTION",
                    requestedPacks = listOf(PACK_GAME),
                    attemptedPacks = emptyList(),
                    exception = throwable,
                    extra = "Thread: ${thread.name}"
                )

                recordEngineBootFailure(
                    "Native uncaught exception on ${thread.name}: " +
                            "${throwable.javaClass.simpleName}: ${throwable.message ?: "(no message)"}"
                )

                getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString("last_crash", diagnostic)
                    .commit()
            } catch (e: Exception) {
                Log.e(TAG, "Could not save crash diagnostic", e)
            }

            previousHandler?.uncaughtException(thread, throwable)
        }
    }

    private fun consumeLastCrashDiagnostic(): String? {
        return try {
            val prefs = getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
            val value = prefs.getString("last_crash", null)
            if (value != null) {
                prefs.edit().remove("last_crash").apply()
            }
            value
        } catch (e: Exception) {
            null
        }
    }
    private fun normalizePackName(packName: String): String {
        return packName.trim().lowercase(Locale.ROOT)
    }

    private fun normalizeSku(sku: String): String {
        return sku.trim().lowercase(Locale.ROOT)
    }

    private fun isPackReallyAvailable(packNameRaw: String): Boolean {
        val packName = normalizePackName(packNameRaw)

        return when (packName) {
            PACK_GAME -> baseHasRequiredBootFiles()
            in RUNTIME_FETCH_PACKS -> hasDownloadedPackLocation(packName) && hasLanguageFiles(packName)
            else -> false
        }
    }

    private fun isKnownPackName(packNameRaw: String): Boolean {
        val packName = normalizePackName(packNameRaw)
        return packName == PACK_GAME || packName in ALL_KNOWN_LANGUAGE_PACKS
    }

    private fun isRuntimeFetchPack(packNameRaw: String): Boolean {
        return normalizePackName(packNameRaw) in RUNTIME_FETCH_PACKS
    }

    private fun statusName(status: Int): String {
        return when (status) {
            AssetPackStatus.PENDING -> "PENDING"
            AssetPackStatus.DOWNLOADING -> "DOWNLOADING"
            AssetPackStatus.TRANSFERRING -> "TRANSFERRING"
            AssetPackStatus.COMPLETED -> "COMPLETED"
            AssetPackStatus.FAILED -> "FAILED"
            AssetPackStatus.CANCELED -> "CANCELED"
            AssetPackStatus.WAITING_FOR_WIFI -> "WAITING_FOR_WIFI"
            AssetPackStatus.NOT_INSTALLED -> "NOT_INSTALLED"
            else -> "UNKNOWN_$status"
        }
    }

    private fun joinOrNone(items: Collection<String>): String {
        return if (items.isEmpty()) "(none)" else items.joinToString(", ")
    }

    private fun appVersionDebugSummary(): String {
        return try {
            val info = packageManager.getPackageInfo(packageName, 0)
            val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info.longVersionCode.toString()
            } else {
                info.versionCode.toString()
            }
            "${info.versionName ?: "unknown"} ($code)"
        } catch (e: Exception) {
            "unknown: ${e.javaClass.simpleName} ${e.message ?: ""}"
        }
    }

    private fun installSourceDebugSummary(): String {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val sourceInfo = packageManager.getInstallSourceInfo(packageName)
                "installing=${sourceInfo.installingPackageName ?: "unknown"}, " +
                        "initiating=${sourceInfo.initiatingPackageName ?: "unknown"}, " +
                        "originating=${sourceInfo.originatingPackageName ?: "unknown"}"
            } else {
                packageManager.getInstallerPackageName(packageName) ?: "unknown"
            }
        } catch (e: Exception) {
            "unknown: ${e.javaClass.simpleName} ${e.message ?: ""}"
        }
    }

    private fun networkDebugSummary(): String {
        return try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = connectivityManager.activeNetwork ?: return "none"
            val caps = connectivityManager.getNetworkCapabilities(network) ?: return "none/caps-null"

            val transports = mutableListOf<String>()
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) transports.add("wifi")
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) transports.add("cellular")
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) transports.add("ethernet")
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) transports.add("vpn")

            val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            val metered = connectivityManager.isActiveNetworkMetered

            "transports=${joinOrNone(transports)}, internet=$hasInternet, validated=$validated, metered=$metered"
        } catch (e: Exception) {
            "unknown: ${e.javaClass.simpleName} ${e.message ?: ""}"
        }
    }

    private fun analyticsNetworkType(): String {
        return try {
            val connectivityManager =
                getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = connectivityManager.activeNetwork ?: return "offline"
            val caps = connectivityManager.getNetworkCapabilities(network) ?: return "unknown"
            val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            if (!hasInternet || !validated) return "offline"

            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                else -> "other"
            }
        } catch (_: Exception) {
            "unknown"
        }
    }

    private fun storageDebugSummary(): String {
        return try {
            val filesMb = filesDir.usableSpace / (1024L * 1024L)
            val cacheMb = cacheDir.usableSpace / (1024L * 1024L)
            "filesFree=${filesMb}MB, cacheFree=${cacheMb}MB"
        } catch (e: Exception) {
            "unknown: ${e.javaClass.simpleName} ${e.message ?: ""}"
        }
    }

    private fun deviceDebugSummary(): String {
        return try {
            val locale = java.util.Locale.getDefault().toLanguageTag()
            "${Build.MANUFACTURER} ${Build.MODEL}, api=${Build.VERSION.SDK_INT}, android=${Build.VERSION.RELEASE}, locale=$locale"
        } catch (e: Exception) {
            "unknown: ${e.javaClass.simpleName} ${e.message ?: ""}"
        }
    }

    private fun packStateDebugSummary(): String {
        val packs = (RUNTIME_FETCH_PACKS + NEVER_FETCH_PACKS + activePackDownloads + packStatuses.keys)
            .map { normalizePackName(it) }
            .filter { it.isNotBlank() }
            .distinct()

        if (packs.isEmpty()) return "(none)"

        return packs.joinToString("; ") { pack ->
            val status = packStatuses[pack]?.let { statusName(it) } ?: "UNKNOWN"
            val progress = packProgress[pack] ?: 0
            val error = packErrors[pack] ?: 0
            val builtIn = pack in NEVER_FETCH_PACKS
            val active = pack in activePackDownloads
            "$pack:status=$status,progress=$progress,error=$error,builtIn=$builtIn,active=$active"
        }
    }

    private fun buildPadDiagnosticMessage(
        title: String,
        code: String,
        requestedPacks: List<String>,
        attemptedPacks: List<String>,
        exception: Throwable? = null,
        extra: String = ""
    ): String {
        val requested = requestedPacks.map { normalizePackName(it) }.filter { it.isNotBlank() }
        val attempted = attemptedPacks.map { normalizePackName(it) }.filter { it.isNotBlank() }
        val exceptionText = exception?.let { "${it.javaClass.simpleName}: ${it.message ?: "(no message)"}" } ?: "(none)"

        return buildString {
            append(title).append("\n\n")
            append("Code: ").append(code).append('\n')
            append("Requested: ").append(joinOrNone(requested)).append('\n')
            append("Attempted fetch: ").append(joinOrNone(attempted)).append('\n')
            append("Allowed runtime fetch: ").append(joinOrNone(RUNTIME_FETCH_PACKS)).append('\n')
            append("Built-in/never fetch: ").append(joinOrNone(NEVER_FETCH_PACKS)).append('\n')
            append("Active PAD states: ").append(joinOrNone(activePackDownloads)).append('\n')
            append("Known states: ").append(packStateDebugSummary()).append('\n')
            append("Network: ").append(networkDebugSummary()).append('\n')
            append("Storage: ").append(storageDebugSummary()).append('\n')
            append("Installer: ").append(installSourceDebugSummary()).append('\n')
            append("App: ").append(appVersionDebugSummary()).append('\n')
            append("Device: ").append(deviceDebugSummary()).append('\n')
            append("Exception: ").append(exceptionText).append('\n')
            if (extra.isNotBlank()) {
                append("Extra: ").append(extra).append('\n')
            }
            append("\nPlease send this screenshot to support.")
        }
    }

    private fun finishCompletedPack(packName: String) {
        activePackDownloads.remove(packName)
        packStatuses[packName] = AssetPackStatus.COMPLETED
        packErrors.remove(packName)
        packProgress[packName] = 100

        updateStatus("✅ $packName ready!")
        updateProgress(100)

        runOnUiThread {
            if (activePackDownloads.isEmpty()) {
                loadingOverlay.postDelayed({
                    loadingOverlay.visibility = View.GONE
                }, 1500)
            }
        }
    }

    private fun verifyCompletedPack(packName: String, attemptsLeft: Int = 10) {
        if (isPackReallyAvailable(packName)) {
            finishCompletedPack(packName)
            return
        }

        if (attemptsLeft <= 0) {
            Log.e(TAG, "❌ Pack $packName reported COMPLETED but files are still not accessible.")
            activePackDownloads.remove(packName)
            packStatuses[packName] = AssetPackStatus.FAILED
            packErrors[packName] = -999

            updateStatus(
                "❌ Asset preparation finished but files are not accessible yet.\n" +
                        "Please restart the app or reinstall from Google Play."
            )
            updateProgress(0)
            return
        }

        activePackDownloads.add(packName)
        updateStatus("📦 Finalizing $packName...")
        updateProgress(98)

        android.os.Handler(mainLooper).postDelayed({
            verifyCompletedPack(packName, attemptsLeft - 1)
        }, 500)
    }

    private fun verifyRuntimeCompletedPack(packName: String, attemptsLeft: Int = 10) {
        if (isPackReallyAvailable(packName)) {
            activePackDownloads.remove(packName)
            packStatuses[packName] = AssetPackStatus.COMPLETED
            packErrors.remove(packName)
            packProgress[packName] = 100

            runOnUiThread {
                // Runtime language downloads are shown by the in-game downloader UI.
                // Never leave the native startup overlay on top of the game for optional packs.
                loadingOverlay.visibility = View.GONE
            }
            return
        }

        if (attemptsLeft <= 0) {
            Log.e(TAG, "❌ Runtime pack $packName reported COMPLETED but files are still not accessible.")
            activePackDownloads.remove(packName)
            packStatuses[packName] = AssetPackStatus.FAILED
            packErrors[packName] = -999
            packProgress[packName] = 0

            runOnUiThread {
                loadingOverlay.visibility = View.GONE
            }
            return
        }

        android.os.Handler(mainLooper).postDelayed({
            verifyRuntimeCompletedPack(packName, attemptsLeft - 1)
        }, 500)
    }

    private fun handleRuntimePackState(state: com.google.android.play.core.assetpacks.AssetPackState, packName: String) {
        // Optional language packs are controlled by the RPG Maker downloader scene.
        // The native overlay is only for startup/install-time files. If it appears during
        // optional downloads, the user can get trapped behind it, so keep it hidden here.
        when (state.status()) {
            AssetPackStatus.PENDING -> {
                activePackDownloads.add(packName)
                packStatuses[packName] = AssetPackStatus.PENDING
                packProgress[packName] = 0
            }

            AssetPackStatus.DOWNLOADING -> {
                activePackDownloads.add(packName)
                packStatuses[packName] = AssetPackStatus.DOWNLOADING

                val bytesDownloaded = state.bytesDownloaded()
                val totalBytes = state.totalBytesToDownload()
                val percent = if (totalBytes > 0) {
                    (100 * bytesDownloaded / totalBytes).toInt()
                } else {
                    0
                }

                packProgress[packName] = percent.coerceIn(0, 100)
                packSizes[packName] = Pair(bytesDownloaded, totalBytes)
            }

            AssetPackStatus.TRANSFERRING -> {
                activePackDownloads.add(packName)
                packStatuses[packName] = AssetPackStatus.TRANSFERRING
                packProgress[packName] = 95
            }

            AssetPackStatus.COMPLETED -> {
                packStatuses[packName] = AssetPackStatus.COMPLETED
                packProgress[packName] = 100
                verifyRuntimeCompletedPack(packName)
            }

            AssetPackStatus.FAILED -> {
                activePackDownloads.remove(packName)
                packStatuses[packName] = AssetPackStatus.FAILED
                packErrors[packName] = state.errorCode()
                packProgress[packName] = 0
                packSizes.remove(packName)
            }

            AssetPackStatus.CANCELED -> {
                activePackDownloads.remove(packName)
                packStatuses[packName] = AssetPackStatus.CANCELED
                packProgress[packName] = 0
                packSizes.remove(packName)
            }

            AssetPackStatus.WAITING_FOR_WIFI -> {
                activePackDownloads.add(packName)
                packStatuses[packName] = AssetPackStatus.WAITING_FOR_WIFI
                packProgress[packName] = 0
            }

            AssetPackStatus.NOT_INSTALLED -> {
                activePackDownloads.remove(packName)
                packStatuses[packName] = AssetPackStatus.NOT_INSTALLED
                packProgress[packName] = 0
                packSizes.remove(packName)
            }

            else -> {
                packStatuses[packName] = state.status()
            }
        }

        runOnUiThread {
            loadingOverlay.visibility = View.GONE
        }
    }

    // ✅ Single global listener to prevent memory leaks and PAD UI chaos.
    // This listener is the source of truth for JS. A pack is not treated as ready
    // until Play Asset Delivery reports COMPLETED and getPackLocation().assetsPath()
    // is actually accessible on disk.
    private val packStateListener = AssetPackStateUpdateListener { state ->
        val packName = normalizePackName(state.name())
        packStatuses[packName] = state.status()
        val totalBytes = state.totalBytesToDownload().coerceAtLeast(0L)
        val downloadedBytes = state.bytesDownloaded()
            .coerceAtLeast(0L)
            .let { downloaded -> if (totalBytes > 0L) downloaded.coerceAtMost(totalBytes) else downloaded }
        if (downloadedBytes > 0L || totalBytes > 0L) {
            packSizes[packName] = Pair(downloadedBytes, totalBytes)
        }

        if (state.errorCode() != AssetPackErrorCode.NO_ERROR) {
            packErrors[packName] = state.errorCode()
        }

        Log.i(TAG, "📦 Pack state update: $packName -> ${statusName(state.status())}")

        if (packName in RUNTIME_FETCH_PACKS) {
            handleRuntimePackState(state, packName)
            return@AssetPackStateUpdateListener
        }

        when (state.status()) {
            AssetPackStatus.PENDING -> {
                activePackDownloads.add(packName)
                Log.d(TAG, "Pack $packName pending")
                updateStatus("⏳ Preparing $packName...")
                updateProgress(5)
            }

            AssetPackStatus.DOWNLOADING -> {
                activePackDownloads.add(packName)

                val bytesDownloaded = state.bytesDownloaded()
                val totalBytes = state.totalBytesToDownload()

                val percent = if (totalBytes > 0) {
                    (100 * bytesDownloaded / totalBytes).toInt()
                } else {
                    0
                }

                packProgress[packName] = percent
                packSizes[packName] = Pair(bytesDownloaded, totalBytes)

                val progressValues = packProgress.values.toList()
                val overallProgress = if (progressValues.isNotEmpty()) {
                    progressValues.average().toInt()
                } else {
                    percent
                }

                val downloadedMB = String.format("%.1f", bytesDownloaded / (1024.0 * 1024.0))
                val totalMB = String.format("%.1f", totalBytes / (1024.0 * 1024.0))

                Log.i(TAG, "📥 Pack $packName downloading: $percent% ($downloadedMB/$totalMB MB)")

                updateProgress(overallProgress)

                val statusBuilder = StringBuilder()
                statusBuilder.append("📥 Downloading $packName\n")
                statusBuilder.append("$percent% ($downloadedMB/$totalMB MB)\n")

                if (packProgress.size > 1) {
                    statusBuilder.append("\nOverall Progress: $overallProgress%\n")
                    packProgress.forEach { (pack, progress) ->
                        val (downloaded, total) = packSizes[pack] ?: Pair(0L, 0L)
                        val sizeMB = if (total > 0) {
                            String.format("%.1f MB", total / (1024.0 * 1024.0))
                        } else {
                            "Unknown"
                        }
                        statusBuilder.append("• $pack: $progress% ($sizeMB)\n")
                    }
                }

                updateStatus(statusBuilder.toString().trim())
            }

            AssetPackStatus.TRANSFERRING -> {
                activePackDownloads.add(packName)
                Log.d(TAG, "Pack $packName transferring...")
                updateStatus("📦 Installing $packName...")
                updateProgress(95)
            }

            AssetPackStatus.COMPLETED -> {
                Log.i(TAG, "✅ Pack $packName completed. Verifying extracted files...")
                packProgress[packName] = 100
                verifyCompletedPack(packName)
            }

            AssetPackStatus.FAILED -> {
                Log.e(TAG, "❌ Pack $packName failed: ${state.errorCode()}")

                activePackDownloads.remove(packName)
                packStatuses[packName] = AssetPackStatus.FAILED
                packErrors[packName] = state.errorCode()
                packProgress[packName] = 0
                packSizes.remove(packName)

                updateStatus(
                    buildPadDiagnosticMessage(
                        title = "❌ Download failed.",
                        code = "PACK_STATE_FAILED_${state.errorCode()}",
                        requestedPacks = listOf(packName),
                        attemptedPacks = listOf(packName),
                        extra = "PAD listener reported FAILED. errorCode=${state.errorCode()}"
                    )
                )
                updateProgress(0)
            }

            AssetPackStatus.CANCELED -> {
                Log.w(TAG, "⏸️ Pack $packName canceled")

                activePackDownloads.remove(packName)
                packStatuses[packName] = AssetPackStatus.CANCELED
                packProgress[packName] = 0
                packSizes.remove(packName)

                updateStatus("⏸️ Download canceled: $packName")
                updateProgress(0)
            }

            AssetPackStatus.WAITING_FOR_WIFI -> {
                activePackDownloads.add(packName)
                Log.w(TAG, "📶 Pack $packName waiting for WiFi")
                updateStatus("📶 Google Play is waiting for Wi-Fi to finish installing game files")
                updateProgress(0)
            }

            AssetPackStatus.NOT_INSTALLED -> {
                activePackDownloads.remove(packName)
                Log.w(TAG, "📋 Pack $packName not installed")
                packSizes.remove(packName)
                updateStatus("📋 Initializing $packName...")
                updateProgress(0)
            }

            else -> {
                Log.d(TAG, "🔄 Pack $packName status: ${state.status()}")
                updateStatus("🔄 Processing $packName...\nStatus: ${statusName(state.status())}")
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        activityStartedAtElapsedMs = SystemClock.elapsedRealtime()
        activityWasColdStart = savedInstanceState == null
        installCrashDiagnosticsHandler()
        beginEngineBootDiagnostic()

        firebaseAnalytics = FirebaseAnalytics.getInstance(this)
        val isDebuggable =
            applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
        val buildChannel = if (isDebuggable) "debug" else "release"
        firebaseAnalytics.setUserProperty("build_channel", buildChannel)
        firebaseAnalytics.setDefaultEventParameters(
            Bundle().apply {
                putString("build_channel", buildChannel)
            }
        )
        setupMetaAppEvents()

        // ✅ ENHANCED LOGGING - Ensure we can see logs
        Log.i(TAG, "🎮 WonderLang MainActivity onCreate() - App starting...")
        Log.i(TAG, "Package name: ${packageName}")
        Log.i(TAG, "Version: ${packageManager.getPackageInfo(packageName, 0).versionName}")

        // Initialize asset pack manager and register the single global listener
        assetPackManager = AssetPackManagerFactory.getInstance(this)
        assetPackManager.registerListener(packStateListener)
        Log.i(TAG, "✅ AssetPackManager initialized")

        setupEdgeToEdgeForGame()

        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        progressBar = findViewById(R.id.progressBar)
        statusText = findViewById(R.id.statusText)
        loadingOverlay = findViewById(R.id.loadingOverlay)

        Log.i(TAG, "✅ Views initialized")

        applySafeAreaInsets()
        setupWebView()
        accountManager = WonderLangAccountManager(this, webView, ACCOUNT_API_BASE_URL)
        webView.addJavascriptInterface(accountManager, "WLAccountManager")
        accountManager.handleIntent(intent)
        setupBillingClient()
        checkAssetPacks()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Inject an 'Escape' key press directly into the RPG Maker game
                webView.evaluateJavascript("""
                    (function() {
                        var evDown = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
                        document.dispatchEvent(evDown);
                        setTimeout(function() {
                            var evUp = new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true });
                            document.dispatchEvent(evUp);
                        }, 50);
                    })();
                """.trimIndent(), null)
            }
        })

        Log.i(TAG, "🎮 WonderLang MainActivity onCreate() completed")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (::accountManager.isInitialized) accountManager.handleIntent(intent)
    }

    private fun setupWebView() {
        // Configure WebViewAssetLoader for installed game assets
        val packHandler = AssetPackPathHandler(this, assetPackManager)
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.local")
            .addPathHandler("/assets/", packHandler)
            .addPathHandler("/", packHandler)  // Handle root-relative paths like /texts/description.json
            .build()

        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.addJavascriptInterface(AndroidBridge(), "AndroidManager")
        webView.requestFocus(View.FOCUS_DOWN)
        webView.requestFocusFromTouch()
        val webViewDebuggable = applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
        WebView.setWebContentsDebuggingEnabled(webViewDebuggable)

        val webSettings = webView.settings
        webSettings.allowFileAccess = false
        webSettings.allowContentAccess = false
        webSettings.domStorageEnabled = true
        webSettings.mediaPlaybackRequiresUserGesture = false
        webSettings.javaScriptEnabled = true
        webSettings.useWideViewPort = true
        webSettings.databaseEnabled = true
        webSettings.loadWithOverviewMode = true
        webSettings.defaultTextEncodingName = "utf-8"
        webSettings.javaScriptCanOpenWindowsAutomatically = true
        webSettings.loadsImagesAutomatically = true
        webSettings.allowFileAccessFromFileURLs = false
        webSettings.allowUniversalAccessFromFileURLs = false
        webSettings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webSettings.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "${msg.message()} -- ${msg.sourceId()}:${msg.lineNumber()}")
                return super.onConsoleMessage(msg)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                // Intercept all requests and serve installed game assets
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun onPageCommitVisible(view: WebView, url: String) {
                trustedGamePageVisible = url.startsWith("https://appassets.local/")
                view.post {
                    view.evaluateJavascript(
                        "setTimeout(()=>{ window.dispatchEvent(new Event('resize')); }, 0);",
                        null
                    )
                    view.invalidate()
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                trustedGamePageVisible = url.startsWith("https://appassets.local/")
                view.postDelayed({
                    view.evaluateJavascript(
                        "window.dispatchEvent(new Event('resize'));",
                        null
                    )
                    view.invalidate()
                }, 100)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                super.onReceivedError(view, request, error)
                Log.e(TAG, "WebView error: ${error.description}")
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()

                // If it's an email link, open the phone's native Gmail/Email app
                if (url.startsWith("mailto:")) {
                    try {
                        val intent = android.content.Intent(android.content.Intent.ACTION_SENDTO)
                        intent.data = android.net.Uri.parse(url)
                        startActivity(intent)
                    } catch (e: Exception) {
                        Log.e(TAG, "No email app found.")
                    }
                    return true // Tell WebView we handled it
                }

                if (!request.isForMainFrame) return false

                val isTrustedGameUrl = url.startsWith("https://appassets.local/")
                trustedGamePageVisible = isTrustedGameUrl
                if (isTrustedGameUrl) return false

                // JavaScript interfaces are powerful native capabilities. Never let an
                // external page load in the same WebView that owns AndroidManager and
                // WLAccountManager; hand normal HTTPS links to the system browser instead.
                val externalUri = request.url
                if (externalUri.scheme == "https") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, externalUri)) }
                }
                return true
            }
        }
    }
    private fun setupEdgeToEdgeForGame() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Modern edge-to-edge setup.
        // Replaces deprecated decorView.systemUiVisibility flags.
        enableEdgeToEdge()
        WindowCompat.setDecorFitsSystemWindows(window, false)

        // Android 15 expects fullscreen apps to support display cutouts properly.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val params = window.attributes
            params.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            window.attributes = params
        }

        hideSystemBars()
    }

    private fun hideSystemBars() {
        val controller = WindowCompat.getInsetsController(window, window.decorView)

        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE

        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun applySafeAreaInsets() {
        val rootView = findViewById<View>(android.R.id.content)

        ViewCompat.setOnApplyWindowInsetsListener(rootView) { _, insets ->
            val cutout = insets.displayCutout
            val rects = cutout?.boundingRects ?: emptyList()

            val hasDisplayCutout = rects.isNotEmpty()

            val viewWidth = rootView.width
            val viewHeight = rootView.height

            var notchLeft = 0
            var notchTop = 0
            var notchRight = 0
            var notchBottom = 0

            if (hasDisplayCutout && viewWidth > 0 && viewHeight > 0) {
                for (rect in rects) {
                    Log.i(TAG, "Cutout rect: left=${rect.left}, top=${rect.top}, right=${rect.right}, bottom=${rect.bottom}")

                    // Top notch/camera hole.
                    if (rect.top <= 0 && rect.bottom > 0) {
                        notchTop = maxOf(notchTop, rect.bottom)
                    }

                    // Left cutout.
                    if (rect.left <= 0 && rect.right > 0) {
                        notchLeft = maxOf(notchLeft, rect.right)
                    }

                    // Right cutout.
                    if (rect.right >= viewWidth && rect.left < viewWidth) {
                        notchRight = maxOf(notchRight, viewWidth - rect.left)
                    }

                    // Bottom cutout.
                    if (rect.bottom >= viewHeight && rect.top < viewHeight) {
                        notchBottom = maxOf(notchBottom, viewHeight - rect.top)
                    }
                }
            }

            // Tiny safety buffer. Set to 0 if you want the exact cutout rectangle only.
            val extraPadding = 0

            val safeLeft = if (notchLeft > 0) notchLeft + extraPadding else 0
            val safeTop = if (notchTop > 0) notchTop + extraPadding else 0
            val safeRight = if (notchRight > 0) notchRight + extraPadding else 0
            val safeBottom = if (notchBottom > 0) notchBottom + extraPadding else 0

            Log.i(
                TAG,
                "Display cutout exact check: hasDisplayCutout=$hasDisplayCutout, " +
                        "rectCount=${rects.size}, " +
                        "viewWidth=$viewWidth, viewHeight=$viewHeight, " +
                        "margins left=$safeLeft, top=$safeTop, right=$safeRight, bottom=$safeBottom"
            )

            setViewMargins(webView, safeLeft, safeTop, safeRight, safeBottom)
            setViewMargins(loadingOverlay, safeLeft, safeTop, safeRight, safeBottom)

            webView.post {
                webView.evaluateJavascript(
                    """
                    (function() {
                        window.WL_SAFE_AREA = {
                            hasDisplayCutout: $hasDisplayCutout,
                            left: $safeLeft,
                            top: $safeTop,
                            right: $safeRight,
                            bottom: $safeBottom
                        };
                        window.dispatchEvent(new Event('resize'));
                    })();
                    """.trimIndent(),
                    null
                )
                webView.invalidate()
            }

            insets
        }

        ViewCompat.requestApplyInsets(rootView)
    }

    private fun dpToPx(dp: Int): Int {
        return (dp * resources.displayMetrics.density).toInt()
    }

    private fun setViewMargins(view: View, left: Int, top: Int, right: Int, bottom: Int) {
        val params = view.layoutParams

        if (params is ViewGroup.MarginLayoutParams) {
            if (
                params.leftMargin != left ||
                params.topMargin != top ||
                params.rightMargin != right ||
                params.bottomMargin != bottom
            ) {
                params.setMargins(left, top, right, bottom)
                view.layoutParams = params
                view.requestLayout()
            }
        }
    }

    private fun hasRecordAudioPermission(): Boolean {
        // Microphone access is intentionally disabled in this build.
        // This prevents MainActivity from requesting the microphone at runtime.
        return false
    }

    private fun speechRecognizerIntent(localeTag: String): Intent {
        val cleanLocale = normalizeSpeechLocale(localeTag)
        return Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, cleanLocale)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        }
    }

    private fun normalizeSpeechLocale(localeTag: String): String {
        val trimmed = localeTag.trim()
        if (trimmed.isBlank()) return Locale.getDefault().toLanguageTag()
        return trimmed.replace('_', '-')
    }

    private fun languageMatches(requested: String, candidate: String): Boolean {
        val req = normalizeSpeechLocale(requested).lowercase(Locale.US)
        val cand = normalizeSpeechLocale(candidate).lowercase(Locale.US)
        if (req == cand) return true
        val reqBase = req.substringBefore('-')
        val candBase = cand.substringBefore('-')
        return reqBase.isNotBlank() && reqBase == candBase
    }

    private fun languageInList(requested: String, languages: List<String>): Boolean {
        return languages.any { languageMatches(requested, it) }
    }

    private fun speechStatusJson(
        ok: Boolean,
        code: String,
        message: String,
        locale: String = "",
        canDownload: Boolean = false,
        installed: List<String> = emptyList(),
        supported: List<String> = emptyList(),
        pending: List<String> = emptyList(),
        online: List<String> = emptyList()
    ): String {
        return JSONObject()
            .put("ok", ok)
            .put("status", if (ok) "ready" else code)
            .put("code", code)
            .put("message", message)
            .put("locale", normalizeSpeechLocale(locale))
            .put("canDownload", canDownload)
            .put("installedOnDeviceLanguages", JSONArray(installed))
            .put("supportedOnDeviceLanguages", JSONArray(supported))
            .put("pendingOnDeviceLanguages", JSONArray(pending))
            .put("onlineLanguages", JSONArray(online))
            .toString()
    }

    private fun runOnUiThreadAndWait(timeoutMs: Long = 1500L, action: () -> Unit): Boolean {
        if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) {
            action()
            return true
        }
        val latch = CountDownLatch(1)
        runOnUiThread {
            try {
                action()
            } finally {
                latch.countDown()
            }
        }
        return latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    }

    private fun getSpeechRecognitionStatusJson(localeTag: String): String {
        val locale = normalizeSpeechLocale(localeTag)

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            return speechStatusJson(
                ok = false,
                code = "speech_recognizer_unavailable",
                message = "Android speech recognition is not available on this device.",
                locale = locale
            )
        }

        if (!hasRecordAudioPermission()) {
            return speechStatusJson(
                ok = false,
                code = "speech_disabled",
                message = "Android speech recognition is disabled in this build.",
                locale = locale
            )
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return speechStatusJson(
                ok = true,
                code = "legacy_available",
                message = "Android speech recognition is available. This Android version cannot report per-language model installation.",
                locale = locale
            )
        }

        var result = speechStatusJson(
            ok = false,
            code = "status_timeout",
            message = "Android did not answer the speech language support check in time.",
            locale = locale
        )
        val supportLatch = CountDownLatch(1)
        runOnUiThread {
            val recognizer = createSpeechRecognizerForDevice()
            recognizer.checkRecognitionSupport(
                speechRecognizerIntent(locale),
                mainExecutor,
                object : RecognitionSupportCallback {
                    override fun onSupportResult(recognitionSupport: RecognitionSupport) {
                        val installed = recognitionSupport.installedOnDeviceLanguages
                        val supported = recognitionSupport.supportedOnDeviceLanguages
                        val pending = recognitionSupport.pendingOnDeviceLanguages
                        val online = recognitionSupport.onlineLanguages
                        result = when {
                            languageInList(locale, installed) -> speechStatusJson(
                                ok = true,
                                code = "ready",
                                message = "Android speech recognition is ready for $locale.",
                                locale = locale,
                                installed = installed,
                                supported = supported,
                                pending = pending,
                                online = online
                            )
                            languageInList(locale, pending) -> speechStatusJson(
                                ok = false,
                                code = "model_download_pending",
                                message = "Android is still downloading speech recognition for $locale.",
                                locale = locale,
                                canDownload = false,
                                installed = installed,
                                supported = supported,
                                pending = pending,
                                online = online
                            )
                            languageInList(locale, supported) -> speechStatusJson(
                                ok = false,
                                code = "model_download_required",
                                message = "Download Android speech recognition for $locale, then return to WonderLang.",
                                locale = locale,
                                canDownload = true,
                                installed = installed,
                                supported = supported,
                                pending = pending,
                                online = online
                            )
                            languageInList(locale, online) -> speechStatusJson(
                                ok = false,
                                code = "on_device_model_missing",
                                message = "This recognizer reports online support for $locale, but no installed on-device language pack.",
                                locale = locale,
                                canDownload = false,
                                installed = installed,
                                supported = supported,
                                pending = pending,
                                online = online
                            )
                            else -> speechStatusJson(
                                ok = false,
                                code = "language_unsupported",
                                message = "Android speech recognition does not report support for $locale on this device.",
                                locale = locale,
                                canDownload = false,
                                installed = installed,
                                supported = supported,
                                pending = pending,
                                online = online
                            )
                        }
                        recognizer.destroy()
                        supportLatch.countDown()
                    }

                    override fun onError(error: Int) {
                        result = speechStatusJson(
                            ok = false,
                            code = "support_check_failed",
                            message = "Android speech support check failed with code $error.",
                            locale = locale
                        )
                        recognizer.destroy()
                        supportLatch.countDown()
                    }
                }
            )
        }

        return if (supportLatch.await(2500L, TimeUnit.MILLISECONDS)) result else speechStatusJson(
            ok = false,
            code = "status_timeout",
            message = "Android speech support check could not run on the main thread.",
            locale = locale
        )
    }

    private fun prepareSpeechRecognitionJson(localeTag: String): String {
        val locale = normalizeSpeechLocale(localeTag)

        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            return speechStatusJson(
                ok = false,
                code = "speech_recognizer_unavailable",
                message = "Android speech recognition is not available on this device.",
                locale = locale
            )
        }

        if (!hasRecordAudioPermission()) {
            return speechStatusJson(
                ok = false,
                code = "speech_disabled",
                message = "Android speech recognition is disabled in this build.",
                locale = locale
            )
        }

        val current = getSpeechRecognitionStatusJson(locale)
        val parsed = JSONObject(current)
        if (parsed.optBoolean("ok", false) || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return current
        }

        if (parsed.optBoolean("canDownload", false)) {
            runOnUiThread {
                try {
                    createSpeechRecognizerForDevice().apply {
                        triggerModelDownload(speechRecognizerIntent(locale))
                        destroy()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Speech model download trigger failed", e)
                }
            }
            return speechStatusJson(
                ok = false,
                code = "model_download_started",
                message = "Android speech recognition download was requested for $locale. Accept any Android prompt, then try again.",
                locale = locale,
                canDownload = false
            )
        }

        return current
    }

    private fun createSpeechRecognizerForDevice(): SpeechRecognizer {
        return if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            SpeechRecognizer.isOnDeviceRecognitionAvailable(this)
        ) {
            SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
        } else {
            SpeechRecognizer.createSpeechRecognizer(this)
        }
    }

    private fun callbackSpeechResult(callbackName: String, payload: JSONObject) {
        val callback = callbackName.ifBlank { "__ShoraAndroidSpeechResult" }
        val script = if (callback.matches(Regex("^[A-Za-z_$][A-Za-z0-9_$]*$"))) {
            "window.$callback(${JSONObject.quote(payload.toString())});"
        } else {
            "window[${JSONObject.quote(callback)}](${JSONObject.quote(payload.toString())});"
        }
        runOnUiThread {
            webView.evaluateJavascript(script, null)
        }
    }

    private fun speechErrorMessage(error: Int): String {
        return when (error) {
            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error."
            SpeechRecognizer.ERROR_CLIENT -> "Speech recognizer client error."
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is missing."
            SpeechRecognizer.ERROR_NETWORK -> "Network error during speech recognition."
            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech recognition network timeout."
            SpeechRecognizer.ERROR_NO_MATCH -> "No matching speech was recognized."
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Speech recognizer is busy."
            SpeechRecognizer.ERROR_SERVER -> "Speech recognition server error."
            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech was heard."
            else -> "Speech recognition failed with code $error."
        }
    }

    private fun startSpeechRecognitionNative(localeTag: String, callbackName: String): String {
        val locale = normalizeSpeechLocale(localeTag)
        val readyJson = prepareSpeechRecognitionJson(locale)
        val ready = JSONObject(readyJson)
        if (!ready.optBoolean("ok", false)) return readyJson

        runOnUiThread {
            try {
                speechRecognizer?.destroy()
                speechCallbackName = callbackName.ifBlank { "__ShoraAndroidSpeechResult" }
                speechRecognizer = createSpeechRecognizerForDevice().apply {
                    setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(params: Bundle?) {
                            callbackSpeechResult(speechCallbackName, JSONObject()
                                .put("ok", true)
                                .put("status", "ready")
                                .put("isFinal", false)
                                .put("locale", locale))
                        }

                        override fun onBeginningOfSpeech() {
                            callbackSpeechResult(speechCallbackName, JSONObject()
                                .put("ok", true)
                                .put("status", "speaking")
                                .put("isFinal", false)
                                .put("locale", locale))
                        }

                        override fun onRmsChanged(rmsdB: Float) {}
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onEndOfSpeech() {
                            callbackSpeechResult(speechCallbackName, JSONObject()
                                .put("ok", true)
                                .put("status", "processing")
                                .put("isFinal", false)
                                .put("locale", locale))
                        }

                        override fun onError(error: Int) {
                            callbackSpeechResult(speechCallbackName, JSONObject()
                                .put("ok", false)
                                .put("error", true)
                                .put("isFinal", true)
                                .put("code", "recognition_error_$error")
                                .put("message", speechErrorMessage(error))
                                .put("locale", locale))
                        }

                        override fun onResults(results: Bundle?) {
                            val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                            callbackSpeechResult(speechCallbackName, JSONObject()
                                .put("ok", true)
                                .put("isFinal", true)
                                .put("text", matches.firstOrNull().orEmpty())
                                .put("alternatives", JSONArray(matches))
                                .put("locale", locale))
                        }

                        override fun onPartialResults(partialResults: Bundle?) {
                            val matches = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                            callbackSpeechResult(speechCallbackName, JSONObject()
                                .put("ok", true)
                                .put("isFinal", false)
                                .put("text", matches.firstOrNull().orEmpty())
                                .put("alternatives", JSONArray(matches))
                                .put("locale", locale))
                        }

                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                    startListening(speechRecognizerIntent(locale))
                }
            } catch (e: Exception) {
                Log.e(TAG, "Native speech start failed", e)
                callbackSpeechResult(speechCallbackName, JSONObject()
                    .put("ok", false)
                    .put("error", true)
                    .put("isFinal", true)
                    .put("code", "start_failed")
                    .put("message", e.message ?: "Android speech recognition could not start.")
                    .put("locale", locale))
            }
        }

        return speechStatusJson(
            ok = true,
            code = "listening",
            message = "Android speech recognition started.",
            locale = locale
        )
    }

    private fun stopSpeechRecognitionNative(): String {
        runOnUiThread {
            try {
                speechRecognizer?.stopListening()
                speechRecognizer?.destroy()
            } catch (e: Exception) {
                Log.e(TAG, "Native speech stop failed", e)
            } finally {
                speechRecognizer = null
            }
        }
        return speechStatusJson(
            ok = true,
            code = "stopped",
            message = "Android speech recognition stopped."
        )
    }

    private fun checkAssetPacks() {
        Log.i(TAG, "🔍 checkAssetPacks() called - attempt ${packCheckRetries + 1}/$MAX_RETRIES")

        val previousCrash = consumeLastCrashDiagnostic()
        if (previousCrash != null) {
            Log.e(TAG, "Previous crash diagnostic found:\n$previousCrash")
        }

        val isDebugMode =
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

        if (isDebugMode) {
            Log.w(TAG, "⚠️ Running in DEBUG mode - Play Asset Delivery may not work properly")
        }

        Log.i(TAG, "📋 Install-time core PAD pack expected: $PACK_GAME")
        Log.i(TAG, "📋 No built-in language pack. FR is optional too.")
        Log.i(TAG, "📋 Optional runtime PAD packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}")

        updateStatus("🎮 Checking installed game files...")
        updateProgress(10)

        val bootFilesReady = baseHasRequiredBootFiles()

        packStatuses[PACK_GAME] = if (bootFilesReady) AssetPackStatus.COMPLETED else AssetPackStatus.NOT_INSTALLED
        packProgress[PACK_GAME] = if (bootFilesReady) 100 else 0
        if (bootFilesReady) packErrors.remove(PACK_GAME)
        activePackDownloads.remove(PACK_GAME)

        // Optional language packs must not block app startup. We only record their current state.
        RUNTIME_FETCH_PACKS.forEach { pack ->
            val ready = isPackReallyAvailable(pack)
            if (ready) {
                packStatuses[pack] = AssetPackStatus.COMPLETED
                packProgress[pack] = 100
                packErrors.remove(pack)
                activePackDownloads.remove(pack)
            } else if (packStatuses[pack] == null) {
                packStatuses[pack] = AssetPackStatus.NOT_INSTALLED
                packProgress[pack] = 0
            }
        }

        if (bootFilesReady) {
            Log.i(TAG, "🎮 Required boot files available. Loading game.")
            packCheckRetries = 0
            loadGame()
            Log.i(TAG, "✅ checkAssetPacks() completed")
            return
        }

        if (packCheckRetries < MAX_RETRIES) {
            packCheckRetries++

            Log.w(
                TAG,
                "🔄 Install-time core files not accessible yet. " +
                        "bootFilesReady=$bootFilesReady, " +
                        "retry $packCheckRetries/$MAX_RETRIES"
            )

            updateStatus(
                buildPadDiagnosticMessage(
                    title = "🔄 Waiting for installed core game files...",
                    code = "INSTALL_TIME_CORE_FILES_NOT_READY",
                    requestedPacks = listOf(PACK_GAME),
                    attemptedPacks = emptyList(),
                    extra = "Retry $packCheckRetries/$MAX_RETRIES. " +
                            "bootFilesReady=$bootFilesReady. " +
                            "Required boot files: data/System.json, data/Actors.json, index.html. " +
                            "Language packs are optional and do not block startup: ${joinOrNone(RUNTIME_FETCH_PACKS)}."
                )
            )
            updateProgress(0)

            android.os.Handler(mainLooper).postDelayed({
                checkAssetPacks()
            }, 3000)

            return
        }

        Log.e(TAG, "💥 Install-time core files missing after retries. bootFilesReady=$bootFilesReady")
        updateStatus(
            buildPadDiagnosticMessage(
                title = "❌ Core game files missing or inaccessible.",
                code = "INSTALL_TIME_CORE_GAME_FILES_MISSING",
                requestedPacks = listOf(PACK_GAME),
                attemptedPacks = emptyList(),
                extra = "The install-time pack named game must include the core game files only. " +
                        "All language packs are optional downloads: ${joinOrNone(RUNTIME_FETCH_PACKS)}. " +
                        "Required boot files: data/System.json, data/Actors.json, index.html." +
                        if (previousCrash != null) "\n\nPrevious crash:\n$previousCrash" else ""
            )
        )
        updateProgress(0)
        Log.i(TAG, "✅ checkAssetPacks() completed with failure")
    }
    private fun fetchAssetPacks(packNames: List<String>, background: Boolean = false) {
        val requestedPacks = packNames
            .map { normalizePackName(it) }
            .filter { it.isNotBlank() }
            .distinct()

        if (requestedPacks.isEmpty()) {
            Log.w(TAG, "fetchAssetPacks called with no valid pack names.")
            return
        }

        Log.i(TAG, "📦 Runtime PAD fetch requested: $requestedPacks")

        val invalidPacks = requestedPacks.filter { !isKnownPackName(it) }
        invalidPacks.forEach { pack ->
            packStatuses[pack] = AssetPackStatus.FAILED
            packErrors[pack] = -996
            packProgress[pack] = 0
            packSizes.remove(pack)
            activePackDownloads.remove(pack)
        }

        val builtInPacks = requestedPacks.filter { it == PACK_GAME || it in BUILT_IN_LANGUAGE_ALIASES }
        builtInPacks.forEach { pack ->
            val ready = isPackReallyAvailable(pack)
            packStatuses[pack] = if (ready) AssetPackStatus.COMPLETED else AssetPackStatus.NOT_INSTALLED
            packProgress[pack] = if (ready) 100 else 0
            if (ready) packErrors.remove(pack)
            activePackDownloads.remove(pack)
        }

        val packsToFetch = requestedPacks
            .filter { it in RUNTIME_FETCH_PACKS }
            .filter { !isPackReallyAvailable(it) }
            .distinct()

        if (invalidPacks.isNotEmpty()) {
            runOnUiThread {
                loadingOverlay.visibility = View.GONE
                updateStatus(
                    buildPadDiagnosticMessage(
                        title = "⚠️ Invalid asset pack request.",
                        code = "INVALID_RUNTIME_PACK_REQUEST",
                        requestedPacks = requestedPacks,
                        attemptedPacks = packsToFetch,
                        extra = "Allowed optional packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}. Never-fetch packs: ${joinOrNone(NEVER_FETCH_PACKS)}. Invalid packs: ${joinOrNone(invalidPacks)}."
                    )
                )
                updateProgress(0)
            }
            if (packsToFetch.isEmpty()) return
        }

        if (packsToFetch.isEmpty()) {
            Log.i(TAG, "📦 No runtime PAD fetch needed. Requested packs are already available or built in: $requestedPacks")
            runOnUiThread {
                if (!background) {
                    updateStatus("✅ Content already available: ${joinOrNone(requestedPacks)}")
                    updateProgress(100)
                    loadingOverlay.postDelayed({
                        if (activePackDownloads.isEmpty()) loadingOverlay.visibility = View.GONE
                    }, 500)
                }
            }
            return
        }

        if (!isNetworkAvailable()) {
            packsToFetch.forEach { pack ->
                packStatuses[pack] = AssetPackStatus.FAILED
                packErrors[pack] = -997
                packProgress[pack] = 0
                packSizes.remove(pack)
                activePackDownloads.remove(pack)
            }

            runOnUiThread {
                loadingOverlay.visibility = View.GONE
                updateStatus(
                    buildPadDiagnosticMessage(
                        title = "📶 You are offline.",
                        code = "OFFLINE_RUNTIME_PACK_DOWNLOAD",
                        requestedPacks = requestedPacks,
                        attemptedPacks = packsToFetch,
                        extra = "Connect to the internet to download optional language packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}."
                    )
                )
                updateProgress(0)
            }
            return
        }

        packsToFetch.forEach { pack ->
            activePackDownloads.add(pack)
            packStatuses[pack] = AssetPackStatus.PENDING
            packProgress[pack] = 0
            packSizes.remove(pack)
            packErrors.remove(pack)
        }

        runOnUiThread {
            loadingOverlay.visibility = View.GONE
            updateStatus("📥 Starting download: ${joinOrNone(packsToFetch)}")
            updateProgress(1)
        }

        try {
            assetPackManager.fetch(packsToFetch)
                .addOnSuccessListener {
                    Log.i(TAG, "✅ PAD fetch started successfully for: $packsToFetch")
                }
                .addOnFailureListener { exception ->
                    Log.e(TAG, "❌ PAD fetch failed to start for: $packsToFetch", exception)

                    val errorCode = if (exception is com.google.android.play.core.assetpacks.AssetPackException) {
                        exception.errorCode
                    } else {
                        -998
                    }

                    packsToFetch.forEach { pack ->
                        activePackDownloads.remove(pack)
                        packStatuses[pack] = AssetPackStatus.FAILED
                        packErrors[pack] = errorCode
                        packProgress[pack] = 0
                        packSizes.remove(pack)
                    }

                    runOnUiThread {
                        loadingOverlay.visibility = View.GONE
                        updateStatus(
                            buildPadDiagnosticMessage(
                                title = "❌ Could not start asset download.",
                                code = "PAD_FETCH_START_FAILED",
                                requestedPacks = requestedPacks,
                                attemptedPacks = packsToFetch,
                                exception = exception,
                                extra = "Allowed optional packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}."
                            )
                        )
                        updateProgress(0)
                    }
                }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Exception while starting PAD fetch for: $packsToFetch", e)

            val errorCode = if (e is com.google.android.play.core.assetpacks.AssetPackException) {
                e.errorCode
            } else {
                -998
            }

            packsToFetch.forEach { pack ->
                activePackDownloads.remove(pack)
                packStatuses[pack] = AssetPackStatus.FAILED
                packErrors[pack] = errorCode
                packProgress[pack] = 0
                packSizes.remove(pack)
            }

            runOnUiThread {
                loadingOverlay.visibility = View.GONE
                updateStatus(
                    buildPadDiagnosticMessage(
                        title = "❌ Could not start asset download.",
                        code = "PAD_FETCH_EXCEPTION",
                        requestedPacks = requestedPacks,
                        attemptedPacks = packsToFetch,
                        exception = e,
                        extra = "Allowed optional packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}."
                    )
                )
                updateProgress(0)
            }
        }
    }


    private fun loadGame() {
        updateStatus("🎮 Loading game...")

        Log.i(TAG, "🎯 Core game data is served from the install-time game pack or app assets.")
        Log.i(TAG, "📋 Startup packs: ${joinOrNone(STARTUP_PACKS)}")
        Log.i(TAG, "📋 No built-in language aliases: ${joinOrNone(BUILT_IN_LANGUAGE_ALIASES)}")
        Log.i(TAG, "📋 Optional runtime PAD packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}")

        Log.d(TAG, "=====================================")

        runOnUiThread {
            loadingOverlay.postDelayed({
                loadingOverlay.visibility = View.GONE
            }, 500)
        }

        if (!isGameLoaded) {
            isGameLoaded = true
            recordEngineBootPhase("webview_loading_game")
            trustedGamePageVisible = true
            webView.loadUrl("https://appassets.local/assets/index.html")
            Log.d(TAG, "Loading game from virtual URL")
        } else {
            Log.d(TAG, "Game already running, just hiding the loading overlay.")
        }
    }

    private fun updateProgress(percent: Int) {
        runOnUiThread {
            progressBar.progress = percent
        }
    }

    private fun updateStatus(message: String) {
        runOnUiThread {
            statusText.text = message
        }
    }

    private fun baseHasRequiredBootFiles(): Boolean {
        return try {
            val requiredFiles = listOf(
                "data/System.json",
                "data/Actors.json",
                "index.html"
            )

            for (file in requiredFiles) {
                val openedCandidate = openFirstBootAssetCandidate(file)

                if (openedCandidate == null) {
                    Log.w(TAG, "Cannot open required boot file through any candidate path: $file")
                    return false
                }

                Log.d(TAG, "✓ Boot file found: $file via $openedCandidate")
            }

            Log.d(TAG, "✓ Base/install-time assets verified: all critical boot files present")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Error checking base/install-time assets", e)
            false
        }
    }


    private fun languageFileCandidatesForPack(packNameRaw: String): List<String> {
        return when (normalizePackName(packNameRaw)) {
            PACK_FR -> listOf(
                "FR/texts/vocab.json",
                "fr/texts/vocab.json"
            )
            PACK_ES -> listOf(
                "ES/texts/vocab.json",
                "es/texts/vocab.json"
            )
            PACK_DE -> listOf(
                "DE/texts/vocab.json",
                "de/texts/vocab.json"
            )
            PACK_PT -> listOf(
                "PT/texts/vocab.json",
                "pt/texts/vocab.json"
            )
            PACK_IT -> listOf(
                "IT/texts/vocab.json",
                "it/texts/vocab.json"
            )
            PACK_KR -> listOf(
                "KR/texts/vocab.json",
                "kr/texts/vocab.json"
            )
            PACK_JP -> listOf(
                "JP/texts/vocab.json",
                "jp/texts/vocab.json"
            )
            PACK_ZH -> listOf(
                "ZH/texts/vocab.json",
                "zh/texts/vocab.json"
            )
            PACK_EN -> listOf(
                "EN/texts/vocab.json",
                "en/texts/vocab.json"
            )
            PACK_US -> listOf(
                "US/texts/vocab.json",
                "us/texts/vocab.json"
            )
            PACK_AR -> listOf(
                "AR/texts/vocab.json",
                "ar/texts/vocab.json"
            )
            else -> emptyList()
        }
    }

    private fun hasLanguageFiles(packNameRaw: String): Boolean {
        val packName = normalizePackName(packNameRaw)
        return languageFileCandidatesForPack(packName).any { candidate ->
            openAssetCandidateForPack(candidate, packName) != null
        }
    }

    private fun hasDownloadedPackLocation(packNameRaw: String): Boolean {
        val packName = normalizePackName(packNameRaw)
        if (packName !in RUNTIME_FETCH_PACKS) return false

        return try {
            val location = assetPackManager.getPackLocation(packName)
            val assetsPath = location?.assetsPath()
            !assetsPath.isNullOrBlank() && File(assetsPath).exists()
        } catch (e: Exception) {
            Log.w(TAG, "Could not read pack location for $packName", e)
            false
        }
    }

    private fun openAssetCandidateForPack(path: String, packNameRaw: String): String? {
        val packName = normalizePackName(packNameRaw)

        if (packName == PACK_GAME || packName in BUILT_IN_LANGUAGE_ALIASES) {
            return openFirstBootAssetCandidate(path)
        }

        if (packName !in RUNTIME_FETCH_PACKS) return null

        return try {
            val location = assetPackManager.getPackLocation(packName) ?: return null
            val assetsPath = location.assetsPath() ?: return null
            val root = File(assetsPath)
            if (!root.exists()) return null

            for (candidate in buildDownloadedPackCandidatePaths(path, packName)) {
                val file = File(root, candidate)
                if (file.exists() && file.isFile && file.length() > 0L) {
                    Log.d(TAG, "✓ Downloaded pack file found: $packName/$candidate")
                    return file.absolutePath
                }
            }

            null
        } catch (e: Exception) {
            Log.w(TAG, "Could not check downloaded pack file. pack=$packName path=$path", e)
            null
        }
    }

    private fun buildDownloadedPackCandidatePaths(path: String, packNameRaw: String): List<String> {
        val packName = normalizePackName(packNameRaw)
        val clean = path
            .removePrefix("/")
            .removePrefix("./")
            .removePrefix("assets/")
            .removePrefix("game/")

        val noPackPrefix = clean.removePrefix("$packName/")
        val candidates = linkedSetOf<String>()

        candidates.add(clean)
        candidates.add(noPackPrefix)
        candidates.add("$packName/$clean")
        candidates.add("$packName/$noPackPrefix")
        candidates.add("assets/$clean")
        candidates.add("assets/$noPackPrefix")

        return expandLanguageCaseCandidates(candidates.toList())
    }

    private fun expandLanguageCaseCandidates(paths: List<String>): List<String> {
        val expanded = linkedSetOf<String>()

        for (path in paths) {
            val clean = path.replace("//", "/").trim()
            if (clean.isBlank()) continue

            expanded.add(clean)

            val parts = clean.split("/").toMutableList()
            for (index in parts.indices) {
                val partLower = parts[index].lowercase()
                when (partLower) {
                    "fr", "es", "de", "jp" -> {
                        val upper = parts.toMutableList()
                        upper[index] = partLower.uppercase()
                        expanded.add(upper.joinToString("/"))

                        val lower = parts.toMutableList()
                        lower[index] = partLower
                        expanded.add(lower.joinToString("/"))
                    }
                }
            }
        }

        return expanded
            .map { it.replace("//", "/") }
            .filter { it.isNotBlank() && !it.split("/").any { part -> part == ".." } }
            .distinct()
    }


    private fun openFirstBootAssetCandidate(path: String): String? {
        val clean = path
            .removePrefix("/")
            .removePrefix("./")
            .removePrefix("assets/")

        val candidates = expandLanguageCaseCandidates(
            listOf(
                clean,
                "game/$clean",
                "assets/$clean",
                "www/$clean",
                "WonderLang/$clean"
            )
        )

        val assetManagers = mutableListOf(assets)

        try {
            val packageContext = createPackageContext(packageName, 0)
            assetManagers.add(packageContext.assets)
        } catch (e: Exception) {
            Log.w(TAG, "Could not create package context while checking boot assets.", e)
        }

        for (candidate in candidates) {
            for (assetManager in assetManagers) {
                try {
                    assetManager.open(candidate).use { stream ->
                        if (stream.available() > 0) {
                            return candidate
                        }
                    }
                } catch (e: Exception) {
                    // Try next candidate.
                }
            }
        }

        Log.w(TAG, "Boot asset candidates failed for $path: ${candidates.joinToString(", ")}")
        return null
    }

    // =========================================================
    // GOOGLE PLAY BILLING ENGINE
    // =========================================================
    private fun setPurchaseStatus(status: String, message: String = "") {
        lastPurchaseStatus = status
        lastPurchaseMessage = message
        Log.i(TAG, "Purchase status: $status $message")
    }

    // =========================================================
    // ANDROID CRASH / ENGINE BOOT DIAGNOSTICS
    // =========================================================
    private fun currentBootCount(): Int {
        return try {
            Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, -1)
        } catch (e: Exception) {
            -1
        }
    }

    private fun beginEngineBootDiagnostic() {
        try {
            val prefs = getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
            val previousState = prefs.getString("launch_state", "none") ?: "none"
            val previousPhase = prefs.getString("launch_phase", "none") ?: "none"
            val previousLaunchNumber = prefs.getLong("launch_number", 0L)
            val previousBootCount = prefs.getInt("launch_boot_count", -1)
            val launchNumber = previousLaunchNumber + 1L

            prefs.edit()
                .putLong("launch_number", launchNumber)
                .putString("previous_launch_state", previousState)
                .putString("previous_launch_phase", previousPhase)
                .putLong("previous_launch_number", previousLaunchNumber)
                .putInt("previous_launch_boot_count", previousBootCount)
                .putBoolean("previous_launch_interrupted", previousState == ENGINE_BOOT_IN_PROGRESS)
                .putString("launch_state", ENGINE_BOOT_IN_PROGRESS)
                .putString("launch_phase", "native_on_create")
                .putInt("launch_boot_count", currentBootCount())
                .putLong("launch_started_at", System.currentTimeMillis())
                .remove("launch_error")
                .commit()
        } catch (e: Exception) {
            Log.e(TAG, "Could not begin engine boot diagnostic", e)
        }
    }

    private fun recordEngineBootPhase(phaseRaw: String) {
        try {
            val phase = phaseRaw.trim().take(80).ifBlank { "unknown" }
            val prefs = getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
            if (prefs.getString("launch_state", "") == ENGINE_BOOT_IN_PROGRESS) {
                prefs.edit()
                    .putString("launch_phase", phase)
                    .putLong("launch_phase_at", System.currentTimeMillis())
                    .commit()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not record engine boot phase", e)
        }
    }

    private fun recordEngineBootFailure(messageRaw: String) {
        try {
            val message = messageRaw.trim().take(2000).ifBlank { "Unknown engine boot failure" }
            val prefs = getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
            val currentState = prefs.getString("launch_state", ENGINE_BOOT_IN_PROGRESS)

            // A later gameplay error must not be reclassified as an engine boot failure.
            if (currentState == ENGINE_BOOT_SUCCEEDED) return

            val editor = prefs.edit()
                .putString("launch_state", ENGINE_BOOT_FAILED)
                .putString("launch_phase", "engine_boot_failed")
                .putString("launch_error", message)
                .putLong("launch_failed_at", System.currentTimeMillis())
                .putInt("last_failure_boot_count", currentBootCount())
                .putLong("last_failure_launch_number", prefs.getLong("launch_number", 0L))
                .putString("last_failure_message", message)

            if (currentState != ENGINE_BOOT_FAILED) {
                editor
                    .putInt(
                        "consecutive_boot_failures",
                        prefs.getInt("consecutive_boot_failures", 0) + 1
                    )
                    .putLong("total_boot_failures", prefs.getLong("total_boot_failures", 0L) + 1L)
            }

            editor.commit()
        } catch (e: Exception) {
            Log.e(TAG, "Could not record engine boot failure", e)
        }
    }

    private fun recordEngineBootSuccess() {
        try {
            val prefs = getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
            if (prefs.getString("launch_state", "") == ENGINE_BOOT_SUCCEEDED) return

            val launchNumber = prefs.getLong("launch_number", 0L)
            val lastFailureLaunch = prefs.getLong("last_failure_launch_number", -1L)
            val lastRecoveredFailureLaunch =
                prefs.getLong("last_recovered_failure_launch_number", -1L)
            val currentBootCount = currentBootCount()
            val lastFailureBootCount = prefs.getInt("last_failure_boot_count", -1)
            var recovery = "none"

            if (lastFailureLaunch > lastRecoveredFailureLaunch &&
                lastFailureLaunch >= 0L &&
                lastFailureLaunch < launchNumber
            ) {
                recovery = when {
                    currentBootCount >= 0 && lastFailureBootCount >= 0 &&
                            currentBootCount > lastFailureBootCount -> "success_after_device_reboot"
                    currentBootCount >= 0 && currentBootCount == lastFailureBootCount ->
                        "success_after_app_reopen_without_reboot"
                    else -> "success_after_previous_failure_boot_status_unknown"
                }
            }

            val editor = prefs.edit()
                .putString("launch_state", ENGINE_BOOT_SUCCEEDED)
                .putString("launch_phase", "game_boot_complete")
                .putLong("launch_succeeded_at", System.currentTimeMillis())
                .putInt("launch_boot_count", currentBootCount)
                .putInt("consecutive_boot_failures", 0)

            if (recovery != "none") {
                editor
                    .putString("last_recovery", recovery)
                    .putLong("last_recovery_at", System.currentTimeMillis())
                    .putLong("last_recovered_failure_launch_number", lastFailureLaunch)
            }

            editor.commit()
        } catch (e: Exception) {
            Log.e(TAG, "Could not record engine boot success", e)
        }
    }

    private fun webViewPackageDebugJson(): JSONObject {
        val result = JSONObject()
        return try {
            val info = WebViewCompat.getCurrentWebViewPackage(this)
            if (info == null) {
                result.put("package", JSONObject.NULL)
                result.put("version", JSONObject.NULL)
                result.put("versionCode", JSONObject.NULL)
            } else {
                val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    info.longVersionCode
                } else {
                    @Suppress("DEPRECATION")
                    info.versionCode.toLong()
                }
                result.put("package", info.packageName)
                result.put("version", info.versionName ?: "unknown")
                result.put("versionCode", code)
            }
            result
        } catch (e: Exception) {
            result.put("error", "${e.javaClass.simpleName}: ${e.message ?: "unknown"}")
        }
    }

    private fun buildCrashDiagnosticsJson(): JSONObject {
        val prefs = getSharedPreferences(DIAGNOSTICS_PREFS, Context.MODE_PRIVATE)
        val appInfo = try {
            packageManager.getPackageInfo(packageName, 0)
        } catch (e: Exception) {
            null
        }
        val appVersionCode = if (appInfo == null) {
            -1L
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            appInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            appInfo.versionCode.toLong()
        }

        return JSONObject().apply {
            put("manufacturer", Build.MANUFACTURER)
            put("model", Build.MODEL)
            put("device", Build.DEVICE)
            put("androidVersion", Build.VERSION.RELEASE)
            put("apiLevel", Build.VERSION.SDK_INT)
            put("securityPatch", Build.VERSION.SECURITY_PATCH)
            put("appVersion", appInfo?.versionName?.trim() ?: "unknown")
            put("appVersionCode", appVersionCode)
            put("webView", webViewPackageDebugJson())
            put("webViewHardwareAccelerated", if (::webView.isInitialized) webView.isHardwareAccelerated else false)
            put("currentBootCount", currentBootCount())
            put("launchNumber", prefs.getLong("launch_number", 0L))
            put("launchState", prefs.getString("launch_state", "unknown"))
            put("launchPhase", prefs.getString("launch_phase", "unknown"))
            put("previousLaunchState", prefs.getString("previous_launch_state", "unknown"))
            put("previousLaunchPhase", prefs.getString("previous_launch_phase", "unknown"))
            put("previousLaunchInterrupted", prefs.getBoolean("previous_launch_interrupted", false))
            put("consecutiveBootFailures", prefs.getInt("consecutive_boot_failures", 0))
            put("totalBootFailures", prefs.getLong("total_boot_failures", 0L))
            put("lastFailureBootCount", prefs.getInt("last_failure_boot_count", -1))
            put("lastFailureMessage", prefs.getString("last_failure_message", ""))
            put("lastRecovery", prefs.getString("last_recovery", "none"))
        }
    }

    private fun setupMetaAppEvents() {
        metaAppEventsLogger = AppEventsLogger.newLogger(applicationContext)

        // Meta App Events are always enabled for the Android app. Automatic IAP
        // logging stays disabled because confirmed Play purchases are logged below
        // with their real product ID, amount, currency, and order ID.
        FacebookSdk.setAutoLogAppEventsEnabled(false)
        FacebookSdk.setAdvertiserIDCollectionEnabled(true)
        metaTrackingEnabled = true
        AppEventsLogger.activateApp(application)
        Log.i(TAG, "Meta App Events tracking enabled.")
    }

    private fun validatedAnalyticsName(rawName: String): String? {
        val name = rawName.trim()
        if (!ANALYTICS_NAME_PATTERN.matches(name)) return null

        val lowerName = name.lowercase(Locale.ROOT)
        if (ANALYTICS_RESERVED_PREFIXES.any { lowerName.startsWith(it) }) return null
        return name
    }

    private fun isUnsafeAnalyticsParameterName(name: String): Boolean {
        val compactName = name.lowercase(Locale.ROOT).replace("_", "")
        return compactName.contains("token") ||
            compactName.contains("orderid") ||
            compactName in ANALYTICS_HIGH_CARDINALITY_KEYS
    }

    private fun isTrustedAnalyticsBridgeCall(): Boolean {
        if (!trustedGamePageVisible) {
            Log.w(TAG, "Rejected Firebase Analytics bridge call outside the trusted game page.")
            return false
        }
        return true
    }

    private fun normalizedAnalyticsContextValue(rawValue: String): String? {
        val normalized = rawValue
            .trim()
            .lowercase(Locale.ROOT)
            .replace(Regex("[^a-z0-9]+"), "_")
            .trim('_')
            .take(64)
        return normalized.takeIf { it.isNotBlank() }
    }

    private fun logAnalyticsScreenViewFromBridge(screenNameRaw: String): Boolean {
        if (!::firebaseAnalytics.isInitialized || !isTrustedAnalyticsBridgeCall()) return false
        val screenName = normalizedAnalyticsContextValue(screenNameRaw) ?: return false
        if (screenName !in ANALYTICS_ALLOWED_SCREEN_NAMES) {
            Log.w(TAG, "Rejected unapproved Firebase Analytics screen name.")
            return false
        }

        return try {
            val params = Bundle().apply {
                putString(FirebaseAnalytics.Param.SCREEN_NAME, screenName)
                putString(FirebaseAnalytics.Param.SCREEN_CLASS, "RpgMakerWebView")
            }
            firebaseAnalytics.logEvent(FirebaseAnalytics.Event.SCREEN_VIEW, params)
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not log Firebase Analytics screen view.", e)
            false
        }
    }

    private fun logGameContentReadyFromBridge(corePackResultRaw: String): Boolean {
        if (!::firebaseAnalytics.isInitialized || !isTrustedAnalyticsBridgeCall()) return false
        if (gameContentReadyLogged) return true

        val reportedCoreResult =
            normalizedAnalyticsContextValue(corePackResultRaw) ?: "unknown"
        val corePackResult = when {
            isPackReallyAvailable(PACK_GAME) -> "ready"
            reportedCoreResult == "missing" -> "missing"
            else -> "unknown"
        }
        val startupMs = if (activityStartedAtElapsedMs > 0L) {
            (SystemClock.elapsedRealtime() - activityStartedAtElapsedMs).coerceAtLeast(0L)
        } else {
            0L
        }

        return try {
            val params = Bundle().apply {
                putLong("startup_ms", startupMs)
                putString("core_pack_result", corePackResult)
                putLong("cold_start", if (activityWasColdStart) 1L else 0L)
            }
            firebaseAnalytics.logEvent("game_content_ready", params)
            gameContentReadyLogged = true
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not log Firebase Analytics game readiness.", e)
            false
        }
    }

    private fun analyticsItemName(sku: String): String {
        return when (sku) {
            "wonderlangfull" -> "WonderLang Polyglot Permanent"
            "wonderlangmonthly" -> "WonderLang Mobile Monthly"
            "wonderlangch1" -> "WonderLang Chapter 1"
            "wonderlangch2" -> "WonderLang Chapter 2"
            "wonderlangch3" -> "WonderLang Chapter 3"
            "wonderlangch4" -> "WonderLang Chapter 4"
            else -> sku
        }
    }

    private fun logAnalyticsCommerceEventFromBridge(
        eventNameRaw: String,
        skuRaw: String,
        contextJson: String
    ): Boolean {
        if (!::firebaseAnalytics.isInitialized || !isTrustedAnalyticsBridgeCall()) return false

        val eventName = eventNameRaw.trim()
        if (eventName != FirebaseAnalytics.Event.SELECT_ITEM &&
            eventName != FirebaseAnalytics.Event.BEGIN_CHECKOUT
        ) {
            Log.w(TAG, "Rejected unapproved Firebase Analytics commerce event.")
            return false
        }

        val sku = normalizeSku(skuRaw)
        if (sku !in ALL_STORE_SKUS) {
            Log.w(TAG, "Rejected unknown Firebase Analytics commerce SKU.")
            return false
        }

        val storePrice = storeProductPrices[sku] ?: run {
            Log.w(TAG, "Could not log Firebase commerce event because Play price is unavailable.")
            return false
        }
        if (contextJson.length > MAX_ANALYTICS_PARAMS_JSON_LENGTH) return false

        return try {
            val price = BigDecimal.valueOf(storePrice.amountMicros, 6).toDouble()
            val itemCategory = when (sku) {
                "wonderlangmonthly" -> "subscription"
                "wonderlangfull" -> "polyglot_permanent"
                else -> "legacy_chapter"
            }
            val item = Bundle().apply {
                putString(FirebaseAnalytics.Param.ITEM_ID, sku)
                putString(FirebaseAnalytics.Param.ITEM_NAME, analyticsItemName(sku))
                putString(FirebaseAnalytics.Param.ITEM_CATEGORY, itemCategory)
                putDouble(FirebaseAnalytics.Param.PRICE, price)
                putLong(FirebaseAnalytics.Param.QUANTITY, 1L)
            }
            val params = Bundle().apply {
                putString(FirebaseAnalytics.Param.CURRENCY, storePrice.currencyCode)
                putDouble(FirebaseAnalytics.Param.VALUE, price)
                putParcelableArray(FirebaseAnalytics.Param.ITEMS, arrayOf(item))
            }

            val context = if (contextJson.isBlank()) JSONObject() else JSONObject(contextJson)
            ANALYTICS_COMMERCE_CONTEXT_KEYS.forEach { key ->
                val value = context.optString(key, "")
                normalizedAnalyticsContextValue(value)?.let { normalized ->
                    params.putString(key, normalized)
                    if (key == "offer_structure") {
                        params.putString(FirebaseAnalytics.Param.ITEM_LIST_NAME, normalized)
                    }
                }
            }

            firebaseAnalytics.logEvent(eventName, params)
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not log Firebase Analytics commerce event.", e)
            false
        }
    }

    private fun recordBillingAnalyticsResult(billingResult: BillingResult) {
        lastBillingResponseCode = billingResult.responseCode
        lastBillingSubResponseCode = billingResult.onPurchasesUpdatedSubResponseCode
    }

    private fun clearBillingAnalyticsResult() {
        lastBillingResponseCode = ANALYTICS_CODE_UNSET
        lastBillingSubResponseCode = ANALYTICS_CODE_UNSET
    }

    private fun recordProductDetailsAnalyticsResult(
        billingResult: BillingResult,
        startedAtElapsedMs: Long
    ) {
        lastProductDetailsResponseCode = billingResult.responseCode
        lastProductDetailsSubResponseCode = billingResult.onPurchasesUpdatedSubResponseCode
        lastProductDetailsLatencyMs =
            (SystemClock.elapsedRealtime() - startedAtElapsedMs).coerceAtLeast(0L)
    }

    private fun billingAnalyticsStateJson(
        responseCode: Int,
        subResponseCode: Int,
        latencyMs: Long = -1L
    ): String {
        return JSONObject().apply {
            if (responseCode != ANALYTICS_CODE_UNSET) put("responseCode", responseCode)
            if (subResponseCode != ANALYTICS_CODE_UNSET) {
                put("subResponseCode", subResponseCode)
            }
            if (latencyMs >= 0L) put("latencyMs", latencyMs)
        }.toString()
    }

    private fun logAnalyticsEventFromBridge(eventNameRaw: String, paramsJson: String): Boolean {
        if (!::firebaseAnalytics.isInitialized || !isTrustedAnalyticsBridgeCall()) return false

        val eventName = validatedAnalyticsName(eventNameRaw) ?: run {
            Log.w(TAG, "Rejected invalid Firebase Analytics event name.")
            return false
        }
        if (eventName !in ANALYTICS_ALLOWED_BRIDGE_EVENTS) {
            Log.w(TAG, "Rejected unapproved Firebase Analytics bridge event.")
            return false
        }
        if (paramsJson.length > MAX_ANALYTICS_PARAMS_JSON_LENGTH) {
            Log.w(TAG, "Rejected oversized Firebase Analytics parameters for $eventName.")
            return false
        }

        return try {
            val json = if (paramsJson.isBlank()) JSONObject() else JSONObject(paramsJson)
            val params = Bundle()
            val keys = json.keys()
            var acceptedCount = 0

            while (keys.hasNext() && acceptedCount < MAX_ANALYTICS_PARAMS) {
                val rawKey = keys.next()
                val key = validatedAnalyticsName(rawKey) ?: continue
                if (isUnsafeAnalyticsParameterName(key)) {
                    Log.w(TAG, "Ignored unsafe Firebase Analytics parameter on $eventName.")
                    continue
                }

                val value = json.opt(rawKey)
                val accepted = when (value) {
                    is String -> {
                        if (value.length > MAX_ANALYTICS_STRING_LENGTH ||
                            GOOGLE_PLAY_ORDER_ID_PATTERN.matches(value.trim())
                        ) {
                            false
                        } else {
                            params.putString(key, value)
                            true
                        }
                    }
                    is Boolean -> {
                        // Firebase Analytics accepts integer parameters, so preserve booleans as 1/0.
                        params.putLong(key, if (value) 1L else 0L)
                        true
                    }
                    is Float -> {
                        if (!value.isFinite()) {
                            false
                        } else {
                            params.putDouble(key, value.toDouble())
                            true
                        }
                    }
                    is Double -> {
                        if (!value.isFinite()) {
                            false
                        } else {
                            params.putDouble(key, value)
                            true
                        }
                    }
                    is Number -> {
                        params.putLong(key, value.toLong())
                        true
                    }
                    else -> false // Nulls, arrays, and nested objects are intentionally ignored.
                }

                if (accepted) acceptedCount += 1
            }

            firebaseAnalytics.logEvent(eventName, params)
            true
        } catch (e: Exception) {
            Log.w(TAG, "Could not log Firebase Analytics event $eventName.", e)
            false
        }
    }

    private fun preferredOneTimeOffer(productDetails: ProductDetails): ProductDetails.OneTimePurchaseOfferDetails? {
        val normalizedSku = normalizeSku(productDetails.productId)
        if (normalizedSku == "wonderlangfull") {
            return productDetails.oneTimePurchaseOfferDetailsList
                ?.firstOrNull { offer -> offer.purchaseOptionId == POLYGLOT_PURCHASE_OPTION_ID }
        }
        return productDetails.oneTimePurchaseOfferDetails
            ?: productDetails.oneTimePurchaseOfferDetailsList?.firstOrNull()
    }

    private fun preferredSubscriptionOffer(productDetails: ProductDetails): ProductDetails.SubscriptionOfferDetails? {
        val offers = productDetails.subscriptionOfferDetails.orEmpty()
        // Prefer the configured three-day free trial. If Play says that offer is not
        // eligible for this account, fall back to the first eligible base-plan offer.
        return offers.firstOrNull { offer ->
            offer.pricingPhases.pricingPhaseList.any { phase ->
                phase.priceAmountMicros == 0L && phase.billingPeriod.equals("P3D", ignoreCase = true)
            }
        } ?: offers.firstOrNull()
    }

    private data class CachedStoreProductDetails(
        val formattedPrice: String,
        val storePrice: StoreProductPrice,
        val offerToken: String? = null
    )

    private fun prepareStoreProductDetails(productDetails: ProductDetails): CachedStoreProductDetails? {
        val normalizedSku = normalizeSku(productDetails.productId)
        if (normalizedSku in SUBS_SKUS) {
            val offer = preferredSubscriptionOffer(productDetails) ?: run {
                Log.w(TAG, "No eligible subscription offer returned for ${productDetails.productId}.")
                return null
            }
            val phases = offer.pricingPhases.pricingPhaseList
            val recurringPrice = phases.lastOrNull { it.priceAmountMicros > 0L }
                ?: phases.lastOrNull()
                ?: return null
            val hasThreeDayTrial = phases.any { phase ->
                phase.priceAmountMicros == 0L && phase.billingPeriod.equals("P3D", ignoreCase = true)
            }
            return CachedStoreProductDetails(
                formattedPrice = recurringPrice.formattedPrice,
                storePrice = StoreProductPrice(
                    amountMicros = recurringPrice.priceAmountMicros,
                    currencyCode = recurringPrice.priceCurrencyCode,
                    hasThreeDayTrial = hasThreeDayTrial
                ),
                offerToken = offer.offerToken
            )
        }
        val offer = preferredOneTimeOffer(productDetails) ?: run {
            Log.w(TAG, "No eligible one-time purchase offer returned for ${productDetails.productId}.")
            return null
        }
        return CachedStoreProductDetails(
            formattedPrice = offer.formattedPrice,
            storePrice = StoreProductPrice(
                amountMicros = offer.priceAmountMicros,
                currencyCode = offer.priceCurrencyCode
            ),
            offerToken = offer.offerToken
        )
    }

    private fun cacheStoreProductDetails(productDetails: ProductDetails): Boolean {
        val cached = prepareStoreProductDetails(productDetails) ?: return false
        val normalizedSku = normalizeSku(productDetails.productId)
        if (normalizedSku !in ALL_STORE_SKUS) return false

        synchronized(productDetailsLock) {
            productPrices = productPrices + (normalizedSku to cached.formattedPrice)
            storeProductPrices = storeProductPrices + (normalizedSku to cached.storePrice)
            subscriptionOfferTokens = if (cached.offerToken.isNullOrBlank()) {
                subscriptionOfferTokens - normalizedSku
            } else {
                subscriptionOfferTokens + (normalizedSku to cached.offerToken)
            }
            productDetailsStates = productDetailsStates + (normalizedSku to ProductDetailsState.READY)
            productDetailsMessages = productDetailsMessages - normalizedSku
        }
        return true
    }

    private fun setAllProductDetailsState(state: ProductDetailsState, message: String) {
        synchronized(productDetailsLock) {
            // Invalidate any older asynchronous response before publishing this state.
            productDetailsQueryGeneration += 1L
            productDetailsRefreshInFlight = false
            productDetailsStates = ALL_STORE_SKUS.associateWith { state }
            productDetailsMessages = if (message.isBlank()) {
                emptyMap()
            } else {
                ALL_STORE_SKUS.associateWith { message }
            }
        }
    }

    private fun purchaseTokenFingerprint(purchaseToken: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(purchaseToken.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    private fun logMetaPurchaseIfNeeded(purchase: Purchase, acceptedProductIds: Collection<String>) {
        if (!metaTrackingEnabled || !::metaAppEventsLogger.isInitialized) return

        val preferences = getSharedPreferences("wl_meta_app_events", Context.MODE_PRIVATE)
        val fingerprint = purchaseTokenFingerprint(purchase.purchaseToken)
        val loggedFingerprints = preferences
            .getStringSet("logged_purchase_tokens", emptySet())
            ?.toMutableSet()
            ?: mutableSetOf()

        if (fingerprint in loggedFingerprints) {
            Log.i(TAG, "Meta purchase already reported; skipping duplicate callback.")
            return
        }

        var loggedProductCount = 0
        acceptedProductIds.forEach { productId ->
            val storePrice = storeProductPrices[productId]
            if (storePrice == null) {
                Log.w(TAG, "Meta purchase not reported because Play price data is missing for $productId.")
                return@forEach
            }

            val parameters = Bundle().apply {
                putString(AppEventsConstants.EVENT_PARAM_CONTENT_ID, productId)
                putString(AppEventsConstants.EVENT_PARAM_CONTENT_TYPE, "product")
                purchase.orderId?.let { orderId ->
                    putString(AppEventsConstants.EVENT_PARAM_ORDER_ID, orderId)
                }
            }

            metaAppEventsLogger.logPurchase(
                BigDecimal.valueOf(storePrice.amountMicros, 6),
                Currency.getInstance(storePrice.currencyCode),
                parameters
            )
            loggedProductCount++
        }

        if (loggedProductCount == acceptedProductIds.size && loggedProductCount > 0) {
            loggedFingerprints.add(fingerprint)
            preferences.edit()
                .putStringSet("logged_purchase_tokens", loggedFingerprints)
                .apply()
            metaAppEventsLogger.flush()
            Log.i(TAG, "Meta purchase reported for ${acceptedProductIds.joinToString()}.")
        }
    }

    private fun currentVersionCodeForReview(): Long {
        val info = packageManager.getPackageInfo(packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }
    }

    private fun requestGooglePlayReview(): String {
        if (reviewFlowInProgress) return "IN_PROGRESS"

        val preferences = getSharedPreferences("wl_google_play_review", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val currentVersion = currentVersionCodeForReview()
        val lastAttemptAt = preferences.getLong("last_attempt_at", 0L)
        val lastAttemptVersion = preferences.getLong("last_attempt_version", -1L)
        val minimumIntervalMs = TimeUnit.DAYS.toMillis(90)

        if (lastAttemptVersion == currentVersion ||
            (lastAttemptAt > 0L && now - lastAttemptAt < minimumIntervalMs)
        ) {
            Log.i(TAG, "Google Play review request throttled by the app.")
            return "THROTTLED"
        }

        reviewFlowInProgress = true
        runOnUiThread {
            val manager = ReviewManagerFactory.create(this@MainActivity)
            manager.requestReviewFlow()
                .addOnCompleteListener { requestTask ->
                    if (!requestTask.isSuccessful) {
                        reviewFlowInProgress = false
                        Log.w(TAG, "Google Play review information was unavailable.", requestTask.exception)
                        return@addOnCompleteListener
                    }

                    preferences.edit()
                        .putLong("last_attempt_at", System.currentTimeMillis())
                        .putLong("last_attempt_version", currentVersion)
                        .apply()

                    manager.launchReviewFlow(this@MainActivity, requestTask.result)
                        .addOnCompleteListener {
                            reviewFlowInProgress = false
                            // Google Play intentionally does not reveal whether the card was
                            // displayed or whether the player submitted a review.
                            Log.i(TAG, "Google Play review flow completed.")
                        }
                }
        }

        return "STARTED"
    }

    private fun openGooglePlayReviewPage(): Boolean {
        return try {
            val playStoreIntent = Intent(
                Intent.ACTION_VIEW,
                Uri.parse("market://details?id=$packageName")
            ).apply {
                setPackage("com.android.vending")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            try {
                startActivity(playStoreIntent)
            } catch (_: Exception) {
                startActivity(
                    Intent(
                        Intent.ACTION_VIEW,
                        Uri.parse("https://play.google.com/store/apps/details?id=$packageName")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
            true
        } catch (e: Exception) {
            Log.e(TAG, "Could not open the Google Play review page.", e)
            false
        }
    }

    private fun billingResponseName(responseCode: Int): String {
        return when (responseCode) {
            BillingClient.BillingResponseCode.OK -> "OK"
            BillingClient.BillingResponseCode.USER_CANCELED -> "USER_CANCELED"
            BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE -> "SERVICE_UNAVAILABLE"
            BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "BILLING_UNAVAILABLE"
            BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "ITEM_UNAVAILABLE"
            BillingClient.BillingResponseCode.DEVELOPER_ERROR -> "DEVELOPER_ERROR"
            BillingClient.BillingResponseCode.ERROR -> "ERROR"
            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> "ITEM_ALREADY_OWNED"
            BillingClient.BillingResponseCode.ITEM_NOT_OWNED -> "ITEM_NOT_OWNED"
            BillingClient.BillingResponseCode.SERVICE_DISCONNECTED -> "SERVICE_DISCONNECTED"
            BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED -> "FEATURE_NOT_SUPPORTED"
            BillingClient.BillingResponseCode.NETWORK_ERROR -> "NETWORK_ERROR"
            else -> "CODE_$responseCode"
        }
    }

    private fun billingSubResponseName(billingResult: BillingResult): String? {
        return when (billingResult.onPurchasesUpdatedSubResponseCode) {
            BillingClient.OnPurchasesUpdatedSubResponseCode.PAYMENT_DECLINED_DUE_TO_INSUFFICIENT_FUNDS -> {
                "PAYMENT_DECLINED_DUE_TO_INSUFFICIENT_FUNDS"
            }
            BillingClient.OnPurchasesUpdatedSubResponseCode.USER_INELIGIBLE -> "USER_INELIGIBLE"
            else -> null
        }
    }

    private fun setBillingFailureStatus(prefix: String, billingResult: BillingResult, fallbackMessage: String) {
        recordBillingAnalyticsResult(billingResult)
        val responseName = billingResponseName(billingResult.responseCode)
        val subResponseName = billingSubResponseName(billingResult)
        val statusSuffix = listOfNotNull(responseName, subResponseName).joinToString("_")
        val message = billingResult.debugMessage.ifBlank { fallbackMessage }
        setPurchaseStatus("${prefix}_$statusSuffix", message)
        Log.e(
            TAG,
            "$prefix: $statusSuffix (${billingResult.responseCode}/" +
                "${billingResult.onPurchasesUpdatedSubResponseCode}): $message"
        )
    }

    private fun acceptedProducts(purchase: Purchase): Set<String> {
        val normalizedProducts = purchase.products
            .map { it.trim().lowercase(Locale.ROOT) }
            .filter { it in ALL_STORE_SKUS }
            .toSet()

        if (normalizedProducts.size != purchase.products.size) {
            val rejected = purchase.products.filter { it.trim().lowercase(Locale.ROOT) !in ALL_STORE_SKUS }
            Log.e(TAG, "Ignoring unknown product IDs from a Play purchase: ${rejected.joinToString()}.")
        }

        return normalizedProducts
    }

    private fun handlePurchase(
        purchase: Purchase,
        ownedTarget: MutableSet<String> = purchasedProducts,
        pendingTarget: MutableSet<String> = pendingProducts,
        historicalFullTarget: MutableSet<String> = historicalFullUpgradeProducts
    ): PurchaseHandlingResult {
        val products = acceptedProducts(purchase)
        if (products.isEmpty()) return PurchaseHandlingResult.IGNORED

        return when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                pendingTarget.removeAll(products)

                // Acknowledged one-time purchases remain usable offline. Chapter receipts
                // preserve their exact chapter forever; only receipts completed by the
                // migration cutoff receive the local full-game fallback.
                val locallyRestorable = products.filterTo(mutableSetOf()) { productId ->
                    purchase.isAcknowledged && productId in IN_APP_SKUS
                }
                ownedTarget.addAll(locallyRestorable)
                historicalFullTarget.removeAll(products)
                historicalFullTarget.addAll(locallyRestorable.filter { productId ->
                    productId in CHAPTER_SKUS && purchase.purchaseTime <= LEGACY_CHAPTER_FULL_UPGRADE_CUTOFF_MS
                })

                if (!::accountManager.isInitialized || !accountManager.isSignedIn()) {
                    if (locallyRestorable.isEmpty()) {
                        setPurchaseStatus("SIGN_IN_REQUIRED", "Sign in to WonderLang so this purchase can be verified and restored on every device.")
                        return PurchaseHandlingResult.SIGN_IN_REQUIRED
                    }
                    return PurchaseHandlingResult.PURCHASED
                }

                products.forEach { productId -> submitPurchaseClaim(purchase, productId) }
                if (locallyRestorable.containsAll(products)) {
                    PurchaseHandlingResult.PURCHASED
                } else {
                    PurchaseHandlingResult.VERIFYING
                }
            }
            Purchase.PurchaseState.PENDING -> {
                pendingTarget.addAll(products)
                ownedTarget.removeAll(products)
                Log.i(TAG, "Purchase pending for ${products.joinToString()}; access has not been granted.")
                PurchaseHandlingResult.PENDING
            }
            else -> {
                Log.w(TAG, "Ignoring purchase with unspecified state for ${products.joinToString()}.")
                PurchaseHandlingResult.IGNORED
            }
        }
    }

    private fun submitPurchaseClaim(purchase: Purchase, productId: String) {
        val fingerprint = purchaseTokenFingerprint(purchase.purchaseToken) + ":" + productId
        if (!purchaseClaimsInFlight.add(fingerprint)) return

        val kind = if (productId in SUBS_SKUS) "subscription" else "one_time"
        accountManager.claimGooglePlayPurchase(kind, productId, purchase.purchaseToken) { success, _, error ->
            purchaseClaimsInFlight.remove(fingerprint)
            synchronized(purchaseQueryLock) {
                // A server verification is newer than any Play snapshot already in flight.
                purchaseQueryGeneration += 1L
                purchaseQueryInFlight = false
                if (success) {
                    purchasedProducts.add(productId)
                    pendingProducts.remove(productId)
                }
            }
            if (success) {
                // Never send subscription starts/renewals to Meta from the device. Stripe and
                // server automation own recurring conversion policy; this preserves the legacy
                // one-time event only after receipt verification.
                if (productId in IN_APP_SKUS) logMetaPurchaseIfNeeded(purchase, listOf(productId))
                setPurchaseStatus("PURCHASED", "Purchase verified. Full WonderLang access is ready.")
            } else {
                setPurchaseStatus(
                    "VERIFICATION_FAILED",
                    error ?: "Google Play completed the payment, but WonderLang could not verify it yet. Sign in and use Restore purchases."
                )
            }
        }
    }

    private fun setupBillingClient() {
        billingClient = BillingClient.newBuilder(this)
            .setListener { billingResult, purchases ->
                recordBillingAnalyticsResult(billingResult)
                when (billingResult.responseCode) {
                    BillingClient.BillingResponseCode.OK -> {
                        if (purchases.isNullOrEmpty()) {
                            setPurchaseStatus(
                                "FAILED_EMPTY_PURCHASE_UPDATE",
                                "Google Play returned no completed or pending purchase."
                            )
                        } else {
                            val callbackContext = synchronized(purchaseQueryLock) {
                                val restoreWasActive = lastPurchaseStatus == "RESTORING"
                                // A purchase callback is newer than any entitlement snapshot
                                // already in flight. Invalidate that query before publishing the
                                // new purchase so an older response cannot erase it afterward.
                                purchaseQueryGeneration += 1L
                                purchaseQueryInFlight = false
                                Pair(purchases.map { handlePurchase(it) }, restoreWasActive)
                            }
                            val results = callbackContext.first
                            val restoreWasActive = callbackContext.second

                            if (!restoreWasActive) {
                                when {
                                    PurchaseHandlingResult.VERIFYING in results -> {
                                        setPurchaseStatus("VERIFYING", "Google Play completed the payment. WonderLang is verifying it securely...")
                                    }
                                    PurchaseHandlingResult.PURCHASED in results -> {
                                        setPurchaseStatus("PURCHASED", "Purchase completed.")
                                    }
                                    PurchaseHandlingResult.PENDING in results -> {
                                        setPurchaseStatus(
                                            "PENDING",
                                            "Google Play is still processing this payment. Access has not been granted yet."
                                        )
                                    }
                                    PurchaseHandlingResult.SIGN_IN_REQUIRED in results -> {
                                        setPurchaseStatus("SIGN_IN_REQUIRED", "Sign in to WonderLang, then use Restore purchases to verify this payment.")
                                    }
                                    else -> {
                                        setPurchaseStatus(
                                            "FAILED_INVALID_PURCHASE_UPDATE",
                                            "Google Play returned a purchase that this app cannot grant."
                                        )
                                    }
                                }
                            }

                            // Rebuild a complete authoritative snapshot after invalidating the
                            // older query. If Restore was active, preserving RESTORING lets this
                            // follow-up query deliver RESTORE_COMPLETE (including pending-only).
                            if (!queryPurchases() && restoreWasActive) {
                                setPurchaseStatus(
                                    "RESTORE_FAILED",
                                    "Google Play could not finish checking your existing purchases."
                                )
                            }
                        }
                    }
                    BillingClient.BillingResponseCode.USER_CANCELED -> {
                        setPurchaseStatus("CANCELED", "Purchase canceled.")
                    }
                    BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                        setPurchaseStatus("ITEM_ALREADY_OWNED", "This item is already owned.")
                        queryPurchases()
                    }
                    else -> {
                        setBillingFailureStatus("FAILED", billingResult, "Google Play purchase failed.")
                    }
                }
            }
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .enableAutoServiceReconnection()
            .build()

        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    Log.i(TAG, "Billing client connected successfully.")
                    queryPurchases()
                    queryProductDetails()
                } else {
                    setAllProductDetailsState(
                        ProductDetailsState.BILLING_NOT_READY,
                        billingResult.debugMessage.ifBlank { "Google Play Billing could not connect." }
                    )
                    setBillingFailureStatus("SETUP_FAILED", billingResult, "Google Play Billing could not connect.")
                }
            }

            override fun onBillingServiceDisconnected() {
                Log.w(TAG, "Billing client disconnected; automatic reconnection is enabled.")
                setAllProductDetailsState(
                    ProductDetailsState.BILLING_NOT_READY,
                    "Google Play Billing is reconnecting."
                )
            }
        })
    }

    private fun queryPurchases(): Boolean {
        if (!::billingClient.isInitialized || !billingClient.isReady) return false

        val queryContext = synchronized(purchaseQueryLock) {
            // Coalesce polling, lifecycle, and restore requests onto the active Play query.
            // A manual restore can still attach to this query because its RESTORING status
            // is checked when the callback completes.
            if (purchaseQueryInFlight) return true
            purchaseQueryGeneration += 1L
            purchaseQueryInFlight = true
            Triple(
                purchaseQueryGeneration,
                pendingProducts.toSet(),
                lastPurchaseStatus
            )
        }
        val queryGeneration = queryContext.first
        val previouslyPending = queryContext.second
        val statusBeforeQuery = queryContext.third
        val snapshots = ConcurrentHashMap<String, Pair<BillingResult, List<Purchase>>>()
        val remaining = AtomicInteger(2)
        val types = listOf(BillingClient.ProductType.INAPP, BillingClient.ProductType.SUBS)

        val receive: (String, BillingResult, List<Purchase>) -> Unit = receive@{ type, billingResult, purchases ->
            snapshots[type] = billingResult to purchases
            if (remaining.decrementAndGet() != 0) return@receive

            val isStillCurrent = synchronized(purchaseQueryLock) {
                queryGeneration == purchaseQueryGeneration
            }
            if (!isStillCurrent) return@receive

            val failed = snapshots.values.firstOrNull { (result, _) ->
                result.responseCode != BillingClient.BillingResponseCode.OK
            }?.first
            if (failed != null) {
                synchronized(purchaseQueryLock) {
                    if (queryGeneration == purchaseQueryGeneration) purchaseQueryInFlight = false
                }
                if (lastPurchaseStatus == "RESTORING") {
                    setPurchaseStatus(
                        "RESTORE_FAILED",
                        failed.debugMessage.ifBlank { "Google Play could not check one-time and subscription purchases." }
                    )
                }
                Log.e(TAG, "Combined purchase refresh failed: ${billingResponseName(failed.responseCode)} (${failed.responseCode}).")
                return@receive
            }

            val activeOwned = mutableSetOf<String>()
            val activePending = mutableSetOf<String>()
            val activeHistoricalFull = mutableSetOf<String>()
            val handlingResults = snapshots.values.flatMap { (_, purchasesForType) ->
                purchasesForType.map { purchase -> handlePurchase(purchase, activeOwned, activePending, activeHistoricalFull) }
            }

            val committed = synchronized(purchaseQueryLock) {
                if (queryGeneration != purchaseQueryGeneration) {
                    false
                } else {
                    // Only acknowledged historical one-time purchases are present here.
                    // New one-time and subscription grants are added asynchronously after the
                    // account backend verifies them, or read from accountManager entitlements.
                    purchasedProducts.clear()
                    purchasedProducts.addAll(activeOwned)
                    historicalFullUpgradeProducts.clear()
                    historicalFullUpgradeProducts.addAll(activeHistoricalFull)
                    pendingProducts.clear()
                    pendingProducts.addAll(activePending)
                    purchaseEntitlementSyncCompleted = true
                    purchaseQueryInFlight = false

                    val completedPendingProducts = previouslyPending.intersect(activeOwned)
                    if (lastPurchaseStatus == "RESTORING") {
                        val verificationCount = handlingResults.count { it == PurchaseHandlingResult.VERIFYING }
                        val message = when {
                            verificationCount > 0 ->
                                "Google Play purchases found. WonderLang is verifying $verificationCount purchase(s)..."
                            activeOwned.isNotEmpty() && activePending.isNotEmpty() ->
                                "Purchase check complete. ${activeOwned.size} owned and ${activePending.size} pending product(s) found."
                            activeOwned.isNotEmpty() ->
                                "Purchase check complete. ${activeOwned.size} lifetime purchase(s) restored."
                            activePending.isNotEmpty() ->
                                "Purchase check complete. ${activePending.size} pending product(s) found."
                            PurchaseHandlingResult.SIGN_IN_REQUIRED in handlingResults ->
                                "Purchases were found. Sign in to WonderLang, then restore again to verify them."
                            else -> "Purchase check complete. No existing purchases were found."
                        }
                        val status = when {
                            verificationCount > 0 -> "VERIFYING"
                            PurchaseHandlingResult.SIGN_IN_REQUIRED in handlingResults -> "SIGN_IN_REQUIRED"
                            else -> "RESTORE_COMPLETE"
                        }
                        setPurchaseStatus(status, message)
                    } else {
                        when {
                            completedPendingProducts.isNotEmpty() ->
                                setPurchaseStatus("PURCHASED", "Pending payment completed.")
                            activePending.isNotEmpty() &&
                                (previouslyPending.isNotEmpty() || statusBeforeQuery in setOf("QUERYING", "FLOW_LAUNCHED", "PENDING")) ->
                                setPurchaseStatus("PENDING", "Google Play is still processing this payment. Access has not been granted yet.")
                            previouslyPending.isNotEmpty() && statusBeforeQuery == "PENDING" ->
                                setPurchaseStatus("FAILED_PENDING_NO_LONGER_ACTIVE", "The pending Google Play payment is no longer active. No access was granted.")
                        }
                    }
                    true
                }
            }
            if (committed) Log.i(TAG, "Play snapshot loaded. Local lifetime: $purchasedProducts; pending: $pendingProducts")
        }

        return try {
            types.forEach { productType ->
                val params = QueryPurchasesParams.newBuilder().setProductType(productType).build()
                billingClient.queryPurchasesAsync(params) { result, purchases ->
                    receive(productType, result, purchases)
                }
            }
            true
        } catch (e: Exception) {
            synchronized(purchaseQueryLock) {
                if (queryGeneration == purchaseQueryGeneration) {
                    purchaseQueryInFlight = false
                    if (lastPurchaseStatus == "RESTORING") {
                        setPurchaseStatus(
                            "RESTORE_FAILED",
                            e.message ?: "Google Play could not check your existing purchases."
                        )
                    }
                }
            }
            Log.e(TAG, "Purchase refresh could not start.", e)
            false
        }
    }

    private fun queryProductDetails(): Boolean {
        if (!::billingClient.isInitialized || !billingClient.isReady) {
            setAllProductDetailsState(
                ProductDetailsState.BILLING_NOT_READY,
                "Google Play Billing is not ready yet."
            )
            return false
        }

        val queryGeneration = synchronized(productDetailsLock) {
            if (productDetailsRefreshInFlight) {
                return true
            }
            productDetailsQueryGeneration += 1L
            productDetailsRefreshInFlight = true
            // Keep already loaded products usable while refreshing. Only uncached SKUs need
            // to expose a blocking LOADING state.
            productDetailsStates = ALL_STORE_SKUS.associateWith { sku ->
                if (productPrices.containsKey(sku)) {
                    ProductDetailsState.READY
                } else {
                    ProductDetailsState.LOADING
                }
            }
            productDetailsMessages = emptyMap()
            productDetailsQueryGeneration
        }

        val queryStartedAtElapsedMs = SystemClock.elapsedRealtime()
        val remaining = AtomicInteger(2)
        val results = ConcurrentHashMap<String, Pair<BillingResult, QueryProductDetailsResult>>()

        val publish: (String, BillingResult, QueryProductDetailsResult) -> Unit = publish@{ type, result, detailsResult ->
            results[type] = result to detailsResult
            if (remaining.decrementAndGet() != 0) return@publish

            lastProductDetailsLatencyMs =
                (SystemClock.elapsedRealtime() - queryStartedAtElapsedMs).coerceAtLeast(0L)
            val refreshedPrices = mutableMapOf<String, String>()
            val refreshedStorePrices = mutableMapOf<String, StoreProductPrice>()
            val refreshedOfferTokens = mutableMapOf<String, String>()
            val refreshedStates = ALL_STORE_SKUS
                .associateWith { ProductDetailsState.UNAVAILABLE }
                .toMutableMap()
            val refreshedMessages = mutableMapOf<String, String>()

            results.forEach { (productType, pair) ->
                val (billingResult, queryResult) = pair
                val expectedSkus = if (productType == BillingClient.ProductType.SUBS) SUBS_SKUS else IN_APP_SKUS
                if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                    val responseName = billingResponseName(billingResult.responseCode)
                    expectedSkus.forEach { sku ->
                        refreshedStates[sku] = ProductDetailsState.ERROR
                        refreshedMessages[sku] = "$responseName: ${billingResult.debugMessage.ifBlank { "Google Play could not load this product." }}"
                    }
                    return@forEach
                }

                val unfetchedStatusBySku = queryResult.unfetchedProductList
                    .associate { unfetched -> normalizeSku(unfetched.productId) to unfetched.statusCode }
                queryResult.productDetailsList.forEach detailsLoop@{ details ->
                    val sku = normalizeSku(details.productId)
                    if (sku !in expectedSkus) {
                        Log.w(TAG, "Google Play returned unexpected $productType details for $sku.")
                        return@detailsLoop
                    }
                    val cached = prepareStoreProductDetails(details)
                    if (cached == null) {
                        refreshedMessages[sku] = "Google Play returned this product without an eligible offer."
                        return@detailsLoop
                    }
                    refreshedPrices[sku] = cached.formattedPrice
                    refreshedStorePrices[sku] = cached.storePrice
                    cached.offerToken?.takeIf { it.isNotBlank() }?.let { refreshedOfferTokens[sku] = it }
                    refreshedStates[sku] = ProductDetailsState.READY
                }
                expectedSkus.forEach { sku ->
                    if (refreshedStates[sku] == ProductDetailsState.READY) return@forEach
                    val status = unfetchedStatusBySku[sku]
                    if (status != null) {
                        refreshedMessages[sku] = "Google Play could not fetch this product (status code $status)."
                    } else if (refreshedMessages[sku].isNullOrBlank()) {
                        refreshedMessages[sku] = "Google Play did not return this configured product."
                    }
                }
            }

            // Preserve a previously loaded localized price if one side of a refresh is
            // temporarily incomplete. The purchase button still runs a fresh typed query.
            val cachedPrices = productPrices
            val cachedStorePrices = storeProductPrices
            val cachedOfferTokens = subscriptionOfferTokens
            ALL_STORE_SKUS.forEach { sku ->
                if (refreshedStates[sku] == ProductDetailsState.READY) return@forEach
                val price = cachedPrices[sku]
                val storePrice = cachedStorePrices[sku]
                if (price != null && storePrice != null) {
                    refreshedPrices[sku] = price
                    refreshedStorePrices[sku] = storePrice
                    cachedOfferTokens[sku]?.let { refreshedOfferTokens[sku] = it }
                    refreshedStates[sku] = ProductDetailsState.READY
                    refreshedMessages[sku] = "Using the previously loaded Google Play price; the latest refresh was incomplete."
                }
            }

            synchronized(productDetailsLock) {
                if (queryGeneration != productDetailsQueryGeneration) return@synchronized
                productPrices = refreshedPrices.toMap()
                storeProductPrices = refreshedStorePrices.toMap()
                subscriptionOfferTokens = refreshedOfferTokens.toMap()
                productDetailsStates = refreshedStates.toMap()
                productDetailsMessages = refreshedMessages.toMap()
                productDetailsRefreshInFlight = false
            }
            Log.i(TAG, "Current one-time and subscription prices loaded: $refreshedPrices")
        }

        return try {
            listOf(
                BillingClient.ProductType.INAPP to IN_APP_SKUS,
                BillingClient.ProductType.SUBS to SUBS_SKUS
            ).forEach { (productType, skus) ->
                val productList = skus.map { sku ->
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(sku)
                        .setProductType(productType)
                        .build()
                }
                val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()
                billingClient.queryProductDetailsAsync(params) { billingResult, queryResult ->
                    recordProductDetailsAnalyticsResult(billingResult, queryStartedAtElapsedMs)
                    publish(productType, billingResult, queryResult)
                }
            }
            true
        } catch (e: Exception) {
            lastProductDetailsLatencyMs =
                (SystemClock.elapsedRealtime() - queryStartedAtElapsedMs).coerceAtLeast(0L)
            synchronized(productDetailsLock) {
                if (queryGeneration == productDetailsQueryGeneration) {
                    productDetailsStates = ALL_STORE_SKUS.associateWith { sku ->
                        if (productPrices.containsKey(sku)) {
                            ProductDetailsState.READY
                        } else {
                            ProductDetailsState.ERROR
                        }
                    }
                    productDetailsMessages = ALL_STORE_SKUS.associateWith {
                        e.message ?: "Google Play product refresh could not start."
                    }
                    productDetailsRefreshInFlight = false
                }
            }
            Log.e(TAG, "Product details refresh could not start.", e)
            false
        }
    }

    // =========================================================
    override fun onResume() {
        super.onResume()
        webView.onResume()
        if (::billingClient.isInitialized) {
            queryPurchases()
            if (billingClient.isReady) {
                queryProductDetails()
            }
        }
        hideSystemBars()
        ViewCompat.requestApplyInsets(window.decorView)
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        if (::accountManager.isInitialized) accountManager.destroy()
        webView.destroy()

        // ✅ NEW: Unregister the asset pack listener when the app is destroyed
        assetPackManager.unregisterListener(packStateListener)

        // ✅ NEW: Gracefully close the billing connection to prevent memory leaks
        if (::billingClient.isInitialized) {
            billingClient.endConnection()
            Log.i(TAG, "🔌 Billing client disconnected safely.")
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemBars()
            ViewCompat.requestApplyInsets(window.decorView)

            webView.post {
                webView.evaluateJavascript("window.dispatchEvent(new Event('resize'));", null)
                webView.invalidate()
            }
        }
    }

    inner class AndroidBridge {

        @JavascriptInterface
        fun getCrashDiagnostics(): String {
            return try {
                buildCrashDiagnosticsJson().toString()
            } catch (e: Exception) {
                JSONObject()
                    .put("error", "${e.javaClass.simpleName}: ${e.message ?: "unknown"}")
                    .toString()
            }
        }

        @JavascriptInterface
        fun recordEngineBootPhase(phase: String): Boolean {
            this@MainActivity.recordEngineBootPhase(phase)
            return true
        }

        @JavascriptInterface
        fun recordEngineBootFailure(message: String): String {
            this@MainActivity.recordEngineBootFailure(message)
            return getCrashDiagnostics()
        }

        @JavascriptInterface
        fun recordEngineBootSuccess(): String {
            this@MainActivity.recordEngineBootSuccess()
            return getCrashDiagnostics()
        }

        @JavascriptInterface
        fun getSpeechRecognitionStatus(localeTag: String): String {
            return try {
                getSpeechRecognitionStatusJson(localeTag)
            } catch (e: Exception) {
                Log.e(TAG, "Speech status bridge failed", e)
                speechStatusJson(
                    ok = false,
                    code = "status_exception",
                    message = e.message ?: "Could not check Android speech recognition.",
                    locale = localeTag
                )
            }
        }

        @JavascriptInterface
        fun prepareSpeechRecognition(localeTag: String): String {
            return try {
                val result = prepareSpeechRecognitionJson(localeTag)
                lastSpeechStatusJson = result
                result
            } catch (e: Exception) {
                Log.e(TAG, "Speech prepare bridge failed", e)
                speechStatusJson(
                    ok = false,
                    code = "prepare_exception",
                    message = e.message ?: "Could not prepare Android speech recognition.",
                    locale = localeTag
                )
            }
        }

        @JavascriptInterface
        fun startSpeechRecognition(localeTag: String, callbackName: String): String {
            return try {
                val result = startSpeechRecognitionNative(localeTag, callbackName)
                lastSpeechStatusJson = result
                result
            } catch (e: Exception) {
                Log.e(TAG, "Speech start bridge failed", e)
                speechStatusJson(
                    ok = false,
                    code = "start_exception",
                    message = e.message ?: "Could not start Android speech recognition.",
                    locale = localeTag
                )
            }
        }

        @JavascriptInterface
        fun startSpeechRecognition(localeTag: String): String {
            return startSpeechRecognition(localeTag, "__ShoraAndroidSpeechResult")
        }

        @JavascriptInterface
        fun stopSpeechRecognition(): String {
            return try {
                val result = stopSpeechRecognitionNative()
                lastSpeechStatusJson = result
                result
            } catch (e: Exception) {
                Log.e(TAG, "Speech stop bridge failed", e)
                speechStatusJson(
                    ok = false,
                    code = "stop_exception",
                    message = e.message ?: "Could not stop Android speech recognition."
                )
            }
        }

        @JavascriptInterface
        fun downloadPack(packName: String) {
            val normalizedPackName = normalizePackName(packName)

            Log.i(TAG, "🌐 JS requested asset pack: $normalizedPackName")

            if (normalizedPackName == PACK_GAME || normalizedPackName in BUILT_IN_LANGUAGE_ALIASES) {
                val ready = isPackReallyAvailable(normalizedPackName)
                packStatuses[normalizedPackName] = if (ready) AssetPackStatus.COMPLETED else AssetPackStatus.NOT_INSTALLED
                packProgress[normalizedPackName] = if (ready) 100 else 0
                if (ready) packErrors.remove(normalizedPackName)
                activePackDownloads.remove(normalizedPackName)

                runOnUiThread {
                    if (!ready) loadingOverlay.visibility = View.GONE
                    updateStatus(
                        if (ready) {
                            "🎮 Content is already included at install time.\nPack: $normalizedPackName"
                        } else {
                            buildPadDiagnosticMessage(
                                title = "❌ Built-in game files are missing.",
                                code = "BUILT_IN_PACK_FILES_MISSING",
                                requestedPacks = listOf(normalizedPackName),
                                attemptedPacks = emptyList(),
                                extra = "The game pack is install-time only and cannot be downloaded from inside the app."
                            )
                        }
                    )
                    updateProgress(if (ready) 100 else 0)
                    if (ready) {
                        loadingOverlay.postDelayed({
                            if (activePackDownloads.isEmpty()) loadingOverlay.visibility = View.GONE
                        }, 500)
                    }
                }

                return
            }

            if (normalizedPackName in RUNTIME_FETCH_PACKS) {
                if (isPackReallyAvailable(normalizedPackName)) {
                    packStatuses[normalizedPackName] = AssetPackStatus.COMPLETED
                    packProgress[normalizedPackName] = 100
                    packErrors.remove(normalizedPackName)
                    activePackDownloads.remove(normalizedPackName)

                    runOnUiThread {
                        updateStatus("✅ Language pack already installed: $normalizedPackName")
                        updateProgress(100)
                        loadingOverlay.postDelayed({
                            if (activePackDownloads.isEmpty()) loadingOverlay.visibility = View.GONE
                        }, 500)
                    }
                    return
                }

                fetchAssetPacks(listOf(normalizedPackName))
                return
            }

            packStatuses[normalizedPackName] = AssetPackStatus.FAILED
            packErrors[normalizedPackName] = -996
            packProgress[normalizedPackName] = 0
            packSizes.remove(normalizedPackName)
            activePackDownloads.remove(normalizedPackName)

            runOnUiThread {
                loadingOverlay.visibility = View.GONE
                updateStatus(
                    buildPadDiagnosticMessage(
                        title = "⚠️ This asset pack does not exist in this build.",
                        code = "RUNTIME_PACK_NOT_AVAILABLE",
                        requestedPacks = listOf(normalizedPackName),
                        attemptedPacks = emptyList(),
                        extra = "Allowed optional packs: ${joinOrNone(RUNTIME_FETCH_PACKS)}. Never-fetch packs: ${joinOrNone(NEVER_FETCH_PACKS)}."
                    )
                )
                updateProgress(0)
            }
        }

        @JavascriptInterface
        fun isPackInstalled(packName: String): Boolean {
            val normalizedPackName = normalizePackName(packName)
            return isPackReallyAvailable(normalizedPackName)
        }

        @JavascriptInterface
        fun isPackDownloading(packName: String): Boolean {
            val normalizedPackName = normalizePackName(packName)

            // If the device is offline, never report optional packs as "downloading" to JS.
            // This prevents the downloader menu from showing stale Play Core states forever.
            if (normalizedPackName in RUNTIME_FETCH_PACKS && !isPackReallyAvailable(normalizedPackName) && !isNetworkAvailable()) {
                activePackDownloads.remove(normalizedPackName)
                packStatuses[normalizedPackName] = AssetPackStatus.NOT_INSTALLED
                packProgress[normalizedPackName] = 0
                packSizes.remove(normalizedPackName)
                packErrors[normalizedPackName] = -997
                return false
            }

            val status = packStatuses[normalizedPackName]

            return normalizedPackName in activePackDownloads ||
                    status == AssetPackStatus.PENDING ||
                    status == AssetPackStatus.DOWNLOADING ||
                    status == AssetPackStatus.TRANSFERRING ||
                    status == AssetPackStatus.WAITING_FOR_WIFI
        }

        @JavascriptInterface
        fun getPackDownloadStatus(packName: String): String {
            val normalizedPackName = normalizePackName(packName)

            if (isPackReallyAvailable(normalizedPackName)) return "COMPLETED"

            // Offline optional packs are not actively downloadable. Report them as not installed,
            // not DOWNLOADING / WAITING_FOR_WIFI, so the JS menu does not mislead the player.
            if (normalizedPackName in RUNTIME_FETCH_PACKS && !isNetworkAvailable()) {
                activePackDownloads.remove(normalizedPackName)
                packStatuses[normalizedPackName] = AssetPackStatus.NOT_INSTALLED
                packProgress[normalizedPackName] = 0
                packSizes.remove(normalizedPackName)
                packErrors[normalizedPackName] = -997
                return "NOT_INSTALLED"
            }

            if (isKnownPackName(normalizedPackName)) {
                return packStatuses[normalizedPackName]?.let { statusName(it) } ?: "NOT_INSTALLED"
            }

            return "REMOVED"
        }

        @JavascriptInterface
        fun getPackDownloadProgress(packName: String): Int {
            val normalizedPackName = normalizePackName(packName)

            if (isPackReallyAvailable(normalizedPackName)) return 100
            if (normalizedPackName in RUNTIME_FETCH_PACKS && !isNetworkAvailable()) return 0
            return packProgress[normalizedPackName] ?: 0
        }

        @JavascriptInterface
        fun getPackDownloadSize(packName: String): String {
            val normalizedPackName = normalizePackName(packName)
            val size = if (isKnownPackName(normalizedPackName)) {
                packSizes[normalizedPackName]
            } else {
                null
            }
            val totalBytes = size?.second?.coerceAtLeast(0L) ?: 0L
            val downloadedBytes = (size?.first ?: 0L)
                .coerceAtLeast(0L)
                .let { downloaded -> if (totalBytes > 0L) downloaded.coerceAtMost(totalBytes) else downloaded }

            return JSONObject()
                .put("downloadedBytes", downloadedBytes)
                .put("totalBytes", totalBytes)
                .toString()
        }

        @JavascriptInterface
        fun getPackDownloadError(packName: String): Int {
            val normalizedPackName = normalizePackName(packName)

            return when {
                isPackReallyAvailable(normalizedPackName) -> 0
                normalizedPackName in RUNTIME_FETCH_PACKS && !isNetworkAvailable() -> -997
                normalizedPackName in packErrors -> packErrors[normalizedPackName] ?: 0
                isKnownPackName(normalizedPackName) -> 0
                else -> -996
            }
        }

        @JavascriptInterface
        fun getAnalyticsNetworkType(): String {
            return analyticsNetworkType()
        }

        @JavascriptInterface
        fun requestMobileDataDownload(): Boolean {
            if (!::assetPackManager.isInitialized) {
                return false
            }

            return try {
                runOnUiThread {
                    try {
                        Log.i(TAG, "📶 Requesting Google Play confirmation for mobile data asset download")
                        updateStatus("📶 Waiting for your mobile data confirmation...")

                        assetPackManager.showConfirmationDialog(this@MainActivity)
                            .addOnSuccessListener { result ->
                                if (result == android.app.Activity.RESULT_OK) {
                                    Log.i(TAG, "✅ User accepted mobile data download for asset packs")
                                    updateStatus("📥 Mobile data download allowed. Continuing download...")
                                } else {
                                    Log.w(TAG, "⏸️ User declined or closed mobile data confirmation")
                                    updateStatus("⏸️ Mobile data download was not allowed. Connect to Wi-Fi or try again.")
                                }
                            }
                            .addOnFailureListener { exception ->
                                Log.e(TAG, "❌ Mobile data confirmation dialog failed", exception)
                                updateStatus("❌ Could not open the mobile data confirmation. Please try again or connect to Wi-Fi.")
                            }
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Exception while opening mobile data confirmation", e)
                        updateStatus("❌ Could not open the mobile data confirmation. Please try again or connect to Wi-Fi.")
                    }
                }
                true
            } catch (e: Exception) {
                Log.e(TAG, "❌ Could not request mobile data confirmation", e)
                false
            }
        }

        @JavascriptInterface
        fun exportBackup(filename: String, data: String) {
            pendingExportData = data
            runOnUiThread {
                exportLauncher.launch(filename)
            }
        }

        @JavascriptInterface
        fun importBackup() {
            runOnUiThread {
                importLauncher.launch(arrayOf("*/*")) // Allow any file type
            }
        }

        @JavascriptInterface
        fun isPurchased(sku: String): Boolean {
            val normalizedSku = normalizeSku(sku)
            val historicalLifetime = purchasedProducts.contains("wonderlangfull") || historicalFullUpgradeProducts.isNotEmpty()
            val nativeOwned = when {
                normalizedSku in IN_APP_SKUS && historicalLifetime -> true
                else -> purchasedProducts.contains(normalizedSku)
            }
            val accountOwned = ::accountManager.isInitialized && accountManager.ownsProduct(normalizedSku)
            return nativeOwned || accountOwned
        }

        @JavascriptInterface
        fun getPrice(sku: String): String {
            return productPrices[normalizeSku(sku)] ?: ""
        }

        @JavascriptInterface
        fun hasThreeDayTrial(sku: String): Boolean {
            return storeProductPrices[normalizeSku(sku)]?.hasThreeDayTrial == true
        }

        @JavascriptInterface
        fun refreshProductDetails(): Boolean {
            return queryProductDetails()
        }

        @JavascriptInterface
        fun getProductDetailsState(sku: String): String {
            val normalizedSku = normalizeSku(sku)
            if (normalizedSku !in ALL_STORE_SKUS) return ProductDetailsState.UNAVAILABLE.name

            return productDetailsStates[normalizedSku]?.name
                ?: when {
                    productPrices.containsKey(normalizedSku) -> ProductDetailsState.READY.name
                    ::billingClient.isInitialized && !billingClient.isReady ->
                        ProductDetailsState.BILLING_NOT_READY.name
                    else -> ProductDetailsState.IDLE.name
                }
        }

        @JavascriptInterface
        fun getProductDetailsMessage(sku: String): String {
            val normalizedSku = normalizeSku(sku)
            if (normalizedSku !in ALL_STORE_SKUS) {
                return "This product ID is not configured for WonderLang."
            }
            return productDetailsMessages[normalizedSku] ?: ""
        }

        @JavascriptInterface
        fun getProductDetailsAnalyticsState(): String {
            return billingAnalyticsStateJson(
                responseCode = lastProductDetailsResponseCode,
                subResponseCode = lastProductDetailsSubResponseCode,
                latencyMs = lastProductDetailsLatencyMs
            )
        }

        @JavascriptInterface
        fun isOnline(): Boolean {
            return isNetworkAvailable()
        }

        @JavascriptInterface
        fun isBillingReady(): Boolean {
            return ::billingClient.isInitialized && billingClient.isReady
        }

        @JavascriptInterface
        fun getLastPurchaseStatus(): String {
            return lastPurchaseStatus
        }

        @JavascriptInterface
        fun getLastPurchaseMessage(): String {
            return lastPurchaseMessage
        }

        @JavascriptInterface
        fun clearLastPurchaseState() {
            setPurchaseStatus("IDLE", "")
            clearBillingAnalyticsResult()
        }

        @JavascriptInterface
        fun refreshPurchases(): Boolean {
            if (!::billingClient.isInitialized || !billingClient.isReady) {
                setPurchaseStatus("BILLING_NOT_READY", "Google Play is not ready yet.")
                return false
            }

            setPurchaseStatus("RESTORING", "Checking existing Google Play purchases...")
            return try {
                val started = queryPurchases()
                if (!started) {
                    setPurchaseStatus(
                        "RESTORE_FAILED",
                        "Google Play could not start the purchase check."
                    )
                }
                started
            } catch (e: Exception) {
                setPurchaseStatus(
                    "RESTORE_FAILED",
                    e.message ?: "Google Play could not check your existing purchases."
                )
                Log.e(TAG, "Purchase restore could not start.", e)
                false
            }
        }

        @JavascriptInterface
        fun syncPurchases(): Boolean {
            if (!::billingClient.isInitialized || !billingClient.isReady) return false
            return queryPurchases()
        }

        @JavascriptInterface
        fun getPendingPurchaseCount(): Int {
            return pendingProducts.size
        }

        @JavascriptInterface
        fun getAnalyticsEntitlementTier(): String {
            return synchronized(purchaseQueryLock) {
                when {
                    (::accountManager.isInitialized && accountManager.hasActiveSubscription()) -> "subscription"
                    purchasedProducts.contains("wonderlangmonthly") -> "subscription"
                    (::accountManager.isInitialized && accountManager.hasFullGame()) -> "full"
                    purchasedProducts.contains("wonderlangfull") || historicalFullUpgradeProducts.isNotEmpty() -> "full"
                    purchasedProducts.any { it in CHAPTER_SKUS } -> "chapter"
                    pendingProducts.isNotEmpty() -> "pending"
                    !purchaseEntitlementSyncCompleted -> "unknown"
                    else -> "demo"
                }
            }
        }

        @JavascriptInterface
        fun isMetaTrackingEnabled(): Boolean {
            return metaTrackingEnabled
        }

        @JavascriptInterface
        fun getBillingAnalyticsState(): String {
            return billingAnalyticsStateJson(
                responseCode = lastBillingResponseCode,
                subResponseCode = lastBillingSubResponseCode
            )
        }

        @JavascriptInterface
        fun logAnalyticsScreenView(screenName: String): Boolean {
            return logAnalyticsScreenViewFromBridge(screenName)
        }

        @JavascriptInterface
        fun logGameContentReady(corePackResult: String): Boolean {
            return logGameContentReadyFromBridge(corePackResult)
        }

        @JavascriptInterface
        fun logAnalyticsCommerceEvent(
            eventName: String,
            sku: String,
            contextJson: String
        ): Boolean {
            return logAnalyticsCommerceEventFromBridge(eventName, sku, contextJson)
        }

        @JavascriptInterface
        fun logAnalyticsEvent(eventName: String, paramsJson: String): Boolean {
            return logAnalyticsEventFromBridge(eventName, paramsJson)
        }

        @JavascriptInterface
        fun requestInAppReview(): String {
            return requestGooglePlayReview()
        }

        @JavascriptInterface
        fun openPlayStoreReviewPage(): Boolean {
            runOnUiThread {
                openGooglePlayReviewPage()
            }
            return true
        }

        @JavascriptInterface
        fun purchase(sku: String): String {
            val normalizedSku = sku.trim().lowercase(Locale.ROOT)
            Log.i(TAG, "JS requested purchase for: $normalizedSku")

            if (normalizedSku !in ALL_STORE_SKUS || normalizedSku in CHAPTER_SKUS) {
                setPurchaseStatus("INVALID_SKU", "This product ID is not configured for WonderLang.")
                return "INVALID_SKU"
            }

            if (!isNetworkAvailable()) {
                setPurchaseStatus("OFFLINE", "You are offline. Connect to the internet to buy or restore purchases.")
                return "OFFLINE"
            }

            if (!::billingClient.isInitialized || !billingClient.isReady) {
                setPurchaseStatus("BILLING_NOT_READY", "Google Play is not ready yet. Please check your connection and try again.")
                return "BILLING_NOT_READY"
            }

            if (!::accountManager.isInitialized || !accountManager.isSignedIn()) {
                setPurchaseStatus("SIGN_IN_REQUIRED", "Sign in to WonderLang before purchasing so access can follow you to every platform.")
                if (::accountManager.isInitialized) accountManager.openSignIn()
                return "SIGN_IN_REQUIRED"
            }

            setPurchaseStatus("ACCOUNT_SYNCING", "Preparing your secure WonderLang store account...")
            accountManager.ensureStoreAccountToken(onSuccess = { storeAccountToken ->
                setPurchaseStatus("QUERYING", "Loading product details from Google Play...")
                val productType = if (normalizedSku in SUBS_SKUS) {
                    BillingClient.ProductType.SUBS
                } else {
                    BillingClient.ProductType.INAPP
                }
                val productList = listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(normalizedSku)
                        .setProductType(productType)
                        .build()
                )
                val params = QueryProductDetailsParams.newBuilder().setProductList(productList).build()

                billingClient.queryProductDetailsAsync(params) { billingResult, queryResult ->
                    if (!isNetworkAvailable()) {
                        setPurchaseStatus("OFFLINE", "You are offline. Connect to the internet to buy or restore purchases.")
                        return@queryProductDetailsAsync
                    }
                    if (billingResult.responseCode != BillingClient.BillingResponseCode.OK) {
                        setBillingFailureStatus("PRODUCT_QUERY_FAILED", billingResult, "This product could not be loaded from Google Play.")
                        return@queryProductDetailsAsync
                    }

                    val productDetails = queryResult.productDetailsList
                        .firstOrNull { normalizeSku(it.productId) == normalizedSku }
                    val offerToken = when {
                        productDetails == null -> null
                        normalizedSku in SUBS_SKUS -> preferredSubscriptionOffer(productDetails)?.offerToken
                        else -> preferredOneTimeOffer(productDetails)?.offerToken
                    }
                    val requiresOfferToken = normalizedSku in SUBS_SKUS || normalizedSku == "wonderlangfull"
                    if (productDetails == null || (requiresOfferToken && offerToken.isNullOrBlank())) {
                        setPurchaseStatus("PRODUCT_NOT_FOUND", "This product is not currently available from Google Play.")
                        Log.e(TAG, "Google Play returned no eligible $productType offer for $normalizedSku.")
                        return@queryProductDetailsAsync
                    }

                    cacheStoreProductDetails(productDetails)
                    val detailsBuilder = BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                    offerToken?.takeIf { it.isNotBlank() }?.let { detailsBuilder.setOfferToken(it) }
                    val billingFlowParams = BillingFlowParams.newBuilder()
                        .setProductDetailsParamsList(listOf(detailsBuilder.build()))
                        .setObfuscatedAccountId(storeAccountToken)
                        .build()

                    runOnUiThread {
                        val launchResult = billingClient.launchBillingFlow(this@MainActivity, billingFlowParams)
                        recordBillingAnalyticsResult(launchResult)
                        when (launchResult.responseCode) {
                            BillingClient.BillingResponseCode.OK ->
                                setPurchaseStatus("FLOW_LAUNCHED", "Please complete the transaction on your screen.")
                            BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                                setPurchaseStatus("ITEM_ALREADY_OWNED", "This item is already owned. Verifying it now...")
                                queryPurchases()
                            }
                            BillingClient.BillingResponseCode.USER_CANCELED ->
                                setPurchaseStatus("CANCELED", "Purchase canceled.")
                            else -> setBillingFailureStatus("LAUNCH_FAILED", launchResult, "Google Play could not open the purchase screen.")
                        }
                    }
                }
            }, onFailure = { message ->
                setPurchaseStatus("ACCOUNT_ERROR", message)
            })

            return "STARTED"
        }
    }

    // ✅ NEW: Connectivity check function needed for network safety
    private fun isNetworkAvailable(): Boolean {
        return try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = connectivityManager.activeNetwork ?: return false
            val caps = connectivityManager.getNetworkCapabilities(network) ?: return false

            val hasUsableTransport =
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)

            val hasInternet = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val isValidated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

            hasUsableTransport && hasInternet && isValidated
        } catch (e: Exception) {
            false
        }
    }
}
