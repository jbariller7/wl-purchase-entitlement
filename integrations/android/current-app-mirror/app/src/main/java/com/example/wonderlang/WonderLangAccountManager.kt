package com.wonderlang.app

import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.text.InputType
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.EditText
import androidx.appcompat.app.AlertDialog
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.lifecycle.lifecycleScope
import com.google.android.gms.tasks.Tasks
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential.Companion.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.google.firebase.auth.ActionCodeSettings
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.OAuthProvider
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Account and entitlement bridge for the isolated WonderLang Android migration.
 *
 * Firebase is the identity boundary and the Netlify API is the entitlement boundary.
 * The WebView never receives a password, OAuth secret, Play purchase token, or Firebase
 * refresh token. The short-lived Firebase ID token is exposed only to the trusted local
 * RPG Maker page so it can call the same authenticated cloud-save API as the web account UI.
 */
class WonderLangAccountManager(
    private val activity: MainActivity,
    private val webView: WebView,
    apiBaseUrl: String
) {
    private val tag = "WLAccount"
    private val apiBase = apiBaseUrl.trimEnd('/').also {
        require(it.startsWith("https://")) { "The WonderLang account API must use HTTPS." }
    }
    // Keep the existing default Firebase app dedicated to WonderLang analytics and
    // Crashlytics. Accounts use the isolated entitlement project so signing in cannot
    // accidentally read from or write to the legacy production Firebase project.
    private val entitlementFirebaseApp = FirebaseApp.getApps(activity)
        .firstOrNull { it.name == ENTITLEMENT_FIREBASE_APP_NAME }
        ?: FirebaseApp.initializeApp(
            activity,
            FirebaseOptions.Builder()
                .setApiKey(activity.getString(R.string.wonderlang_entitlements_api_key))
                .setApplicationId(activity.getString(R.string.wonderlang_entitlements_app_id))
                .setProjectId(activity.getString(R.string.wonderlang_entitlements_project_id))
                .setStorageBucket(activity.getString(R.string.wonderlang_entitlements_storage_bucket))
                .setGcmSenderId(activity.getString(R.string.wonderlang_entitlements_sender_id))
                .build(),
            ENTITLEMENT_FIREBASE_APP_NAME
        )
    private val auth = FirebaseAuth.getInstance(entitlementFirebaseApp)
    private val appCheck = FirebaseAppCheck.getInstance(entitlementFirebaseApp).apply {
        installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
        setTokenAutoRefreshEnabled(true)
    }
    private val credentialManager = CredentialManager.create(activity)
    private val executor = Executors.newSingleThreadExecutor()
    private val preferences = activity.getSharedPreferences("wl_account_auth", android.content.Context.MODE_PRIVATE)
    private val offlineLeasePreferences = activity.getSharedPreferences(
        "wl_account_offline_lease",
        android.content.Context.MODE_PRIVATE
    )

    @Volatile private var cachedIdToken = ""
    @Volatile private var cachedStoreAccountToken = ""
    @Volatile private var cachedAccountJson = ""
    @Volatile private var cachedAccountUid = ""
    @Volatile private var fullGameEntitled = false
    @Volatile private var cloudSaveEntitled = false
    @Volatile private var entitlementLeaseExpiresAtWallMs = 0L
    @Volatile private var entitlementVerifiedAtWallMs = 0L
    @Volatile private var entitlementVerifiedAtElapsedMs = 0L
    @Volatile private var entitlementVerifiedBootCount = -1
    @Volatile private var entitlementLeaseMaximumAgeMs = 0L

    private val authListener = FirebaseAuth.AuthStateListener { state ->
        val user = state.currentUser
        if (user == null) {
            publishSignedOut()
        } else {
            if (cachedAccountUid.isNotBlank() && cachedAccountUid != user.uid) {
                clearCachedAccountState(clearLease = true)
            }
            restoreOfflineLease(user)
            refreshAccount(forceTokenRefresh = false)
        }
    }

    init {
        auth.addAuthStateListener(authListener)
        resumePendingAppleFlow()
    }

    fun destroy() {
        auth.removeAuthStateListener(authListener)
        executor.shutdownNow()
    }

    fun handleIntent(intent: Intent?) {
        val emailLink = intent?.data?.toString().orEmpty()
        if (emailLink.isBlank() || !auth.isSignInWithEmailLink(emailLink)) return
        val rememberedEmail = preferences.getString("pending_email", "").orEmpty()
        if (rememberedEmail.isNotBlank()) {
            completeEmailLink(rememberedEmail, emailLink)
        } else {
            promptForEmail(
                title = "Confirm your email",
                message = "Enter the email address that received this WonderLang sign-in link.",
                positiveLabel = "Continue"
            ) { email -> completeEmailLink(email, emailLink) }
        }
    }

    fun isSignedIn(): Boolean = auth.currentUser != null

    fun ownsProduct(productId: String): Boolean {
        if (!hasValidEntitlementLease() || !fullGameEntitled) return false
        return productId.lowercase() in setOf(
            "wonderlangfull",
            "wonderlangmonthly",
            "wonderlangch1",
            "wonderlangch2",
            "wonderlangch3",
            "wonderlangch4"
        )
    }

    fun hasFullGame(): Boolean = hasValidEntitlementLease() && fullGameEntitled

    fun ensureStoreAccountToken(onSuccess: (String) -> Unit, onFailure: (String) -> Unit) {
        val cached = cachedStoreAccountToken
        if (cached.isNotBlank()) {
            activity.runOnUiThread { onSuccess(cached) }
            return
        }
        if (auth.currentUser == null) {
            activity.runOnUiThread { onFailure("Sign in to WonderLang before purchasing.") }
            return
        }
        executor.execute {
            try {
                val token = api("/api/v1/store-account-token", "GET", null)
                    .getString("storeAccountToken")
                UUID.fromString(token)
                cachedStoreAccountToken = token
                activity.runOnUiThread { onSuccess(token) }
            } catch (error: Exception) {
                activity.runOnUiThread {
                    onFailure(safeMessage(error, "WonderLang could not prepare your store account."))
                }
            }
        }
    }

    /**
     * Submit a PURCHASED token. Access is granted by the caller only after this succeeds.
     * The backend validates the receipt, prevents account-token disagreement, records the
     * immutable grant, and acknowledges it with Google Play.
     */
    fun claimGooglePlayPurchase(
        kind: String,
        productId: String,
        purchaseToken: String,
        onComplete: (Boolean, JSONObject?, String?) -> Unit
    ) {
        if (kind !in setOf("subscription", "one_time")) {
            onComplete(false, null, "Unknown Google Play purchase type.")
            return
        }
        executor.execute {
            try {
                val body = JSONObject()
                    .put("kind", kind)
                    .put("productId", productId)
                    .put("purchaseToken", purchaseToken)
                val response = api("/api/v1/google-play/claim", "POST", body)
                val entitlements = response.optJSONObject("entitlements")
                    ?: throw IllegalStateException("The entitlement response was incomplete.")
                publishEntitlements(entitlements, response)
                evaluate(
                    "window.WLAccountEntitlements?._nativePurchaseVerified?.(" +
                        JSONObject.quote(response.toString()) + ")"
                )
                activity.runOnUiThread { onComplete(true, entitlements, null) }
            } catch (error: Exception) {
                val message = safeMessage(error, "WonderLang could not verify this Google Play purchase.")
                evaluate(
                    "window.WLAccountEntitlements?._nativePurchaseFailed?.(" +
                        JSONObject.quote(message) + ")"
                )
                activity.runOnUiThread { onComplete(false, null, message) }
            }
        }
    }

    @JavascriptInterface
    fun getCachedIdToken(): String = cachedIdToken

    @JavascriptInterface
    fun getAccountSnapshot(): String {
        val currentUid = auth.currentUser?.uid.orEmpty()
        if (currentUid.isBlank() || cachedAccountUid != currentUid) return ""
        if (fullGameEntitled) hasValidEntitlementLease()
        return cachedAccountJson
    }

    @JavascriptInterface
    fun getStoreAccountToken(): String = cachedStoreAccountToken

    @JavascriptInterface
    fun isSignedInFromGame(): Boolean = isSignedIn()

    @JavascriptInterface
    fun hasCloudSave(): Boolean = hasValidEntitlementLease() && cloudSaveEntitled

    @JavascriptInterface
    fun openAccount(): Boolean {
        activity.runOnUiThread { showAccountDialog() }
        return true
    }

    @JavascriptInterface
    fun openSignIn(): Boolean {
        activity.runOnUiThread { showSignInDialog() }
        return true
    }

    @JavascriptInterface
    fun refreshEntitlements(): Boolean {
        refreshAccount(forceTokenRefresh = true)
        return auth.currentUser != null
    }

    @JavascriptInterface
    fun refreshIdToken(): Boolean = refreshEntitlements()

    @JavascriptInterface
    fun openExternalUrl(rawUrl: String): Boolean {
        val uri = runCatching { Uri.parse(rawUrl) }.getOrNull() ?: return false
        val host = uri.host?.lowercase().orEmpty()
        val allowed = uri.scheme == "https" && (
            host == "wonderlang.net" ||
                host == "www.wonderlang.net" ||
                host == "billing.stripe.com"
            )
        if (!allowed) return false
        return try {
            activity.runOnUiThread {
                activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun beginGoogleSignIn(): Boolean {
        activity.runOnUiThread { beginGoogle(linkToCurrentUser = false) }
        return true
    }

    @JavascriptInterface
    fun beginAppleSignIn(): Boolean {
        activity.runOnUiThread { beginApple(linkToCurrentUser = false) }
        return true
    }

    @JavascriptInterface
    fun beginEmailLinkSignIn(): Boolean {
        activity.runOnUiThread { beginEmailLink(linkToCurrentUser = false) }
        return true
    }

    @JavascriptInterface
    fun signOut(): Boolean {
        activity.runOnUiThread {
            clearOfflineLease()
            auth.signOut()
            activity.lifecycleScope.launch {
                runCatching { credentialManager.clearCredentialState(ClearCredentialStateRequest()) }
                publishSignedOut()
            }
        }
        return true
    }

    private fun showSignInDialog() {
        AlertDialog.Builder(activity)
            .setTitle("Sign in to WonderLang")
            .setItems(arrayOf("Continue with Google", "Continue with Apple", "Email me a sign-in link")) { _, which ->
                when (which) {
                    0 -> beginGoogle(linkToCurrentUser = false)
                    1 -> beginApple(linkToCurrentUser = false)
                    2 -> beginEmailLink(linkToCurrentUser = false)
                }
            }
            .setNegativeButton("Not now", null)
            .show()
    }

    private fun showAccountDialog() {
        val user = auth.currentUser
        if (user == null) {
            showSignInDialog()
            return
        }
        val providerNames = user.providerData
            .mapNotNull { it.providerId.takeUnless { provider -> provider == "firebase" } }
            .distinct()
            .joinToString()
            .ifBlank { "WonderLang" }
        val label = user.email ?: user.displayName ?: "Signed-in WonderLang account"
        AlertDialog.Builder(activity)
            .setTitle(label)
            .setMessage("Login methods: $providerNames\n\nLinking is always explicit. It joins a new login method to this same WonderLang account.")
            .setItems(arrayOf("Refresh access", "Link Google login", "Link Apple login", "Link email login", "Sign out")) { _, which ->
                when (which) {
                    0 -> refreshAccount(forceTokenRefresh = true)
                    1 -> beginGoogle(linkToCurrentUser = true)
                    2 -> beginApple(linkToCurrentUser = true)
                    3 -> beginEmailLink(linkToCurrentUser = true)
                    4 -> signOut()
                }
            }
            .setNegativeButton("Close", null)
            .show()
    }

    private fun beginGoogle(linkToCurrentUser: Boolean) {
        activity.lifecycleScope.launch {
            try {
                val googleIdOption = GetGoogleIdOption.Builder()
                    .setFilterByAuthorizedAccounts(false)
                    .setServerClientId(activity.getString(R.string.wonderlang_entitlements_google_web_client_id))
                    .build()
                val request = GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build()
                val result = credentialManager.getCredential(activity, request)
                val custom = result.credential as? CustomCredential
                    ?: throw IllegalStateException("Google did not return a supported credential.")
                if (custom.type != TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                    throw IllegalStateException("Google did not return an ID token credential.")
                }
                val google = GoogleIdTokenCredential.createFrom(custom.data)
                val firebaseCredential = GoogleAuthProvider.getCredential(google.idToken, null)
                val task = if (linkToCurrentUser) {
                    val current = auth.currentUser
                        ?: throw IllegalStateException("Sign in before linking another login method.")
                    current.linkWithCredential(firebaseCredential)
                } else {
                    auth.signInWithCredential(firebaseCredential)
                }
                task.addOnSuccessListener { refreshAccount(forceTokenRefresh = true) }
                    .addOnFailureListener { showAuthError(it, if (linkToCurrentUser) "Google login could not be linked." else "Google sign-in failed.") }
            } catch (error: Exception) {
                showAuthError(error, if (linkToCurrentUser) "Google login could not be linked." else "Google sign-in was canceled or failed.")
            }
        }
    }

    private fun appleProvider() = OAuthProvider.newBuilder("apple.com").apply {
        scopes = arrayOf("email", "name").toList()
    }.build()

    private fun beginApple(linkToCurrentUser: Boolean) {
        preferences.edit().putBoolean("pending_apple_link", linkToCurrentUser).apply()
        val task = if (linkToCurrentUser) {
            val current = auth.currentUser
            if (current == null) {
                showAuthError(IllegalStateException("No signed-in account."), "Sign in before linking Apple.")
                return
            }
            current.startActivityForLinkWithProvider(activity, appleProvider())
        } else {
            auth.startActivityForSignInWithProvider(activity, appleProvider())
        }
        task.addOnSuccessListener {
            preferences.edit().remove("pending_apple_link").apply()
            refreshAccount(forceTokenRefresh = true)
        }.addOnFailureListener {
            preferences.edit().remove("pending_apple_link").apply()
            showAuthError(it, if (linkToCurrentUser) "Apple login could not be linked." else "Apple sign-in failed.")
        }
    }

    private fun resumePendingAppleFlow() {
        auth.pendingAuthResult?.addOnSuccessListener {
            preferences.edit().remove("pending_apple_link").apply()
            refreshAccount(forceTokenRefresh = true)
        }?.addOnFailureListener {
            preferences.edit().remove("pending_apple_link").apply()
            showAuthError(it, "Apple sign-in did not finish.")
        }
    }

    private fun beginEmailLink(linkToCurrentUser: Boolean) {
        promptForEmail(
            title = if (linkToCurrentUser) "Link an email login" else "Sign in by email",
            message = "We will send a secure, one-time WonderLang sign-in link. No password is needed.",
            positiveLabel = "Send link"
        ) { email ->
            val settings = ActionCodeSettings.newBuilder()
                .setUrl("https://wonderlang.net/account")
                .setHandleCodeInApp(true)
                .setAndroidPackageName(activity.packageName, false, null)
                .setLinkDomain("wonderlang-accounts.firebaseapp.com")
                .build()
            preferences.edit()
                .putString("pending_email", email)
                .putBoolean("pending_email_link", linkToCurrentUser)
                .apply()
            auth.sendSignInLinkToEmail(email, settings)
                .addOnSuccessListener {
                    AlertDialog.Builder(activity)
                        .setTitle("Check your email")
                        .setMessage("Open the WonderLang link on this device to finish. The link is single-use.")
                        .setPositiveButton("OK", null)
                        .show()
                }
                .addOnFailureListener { showAuthError(it, "The sign-in email could not be sent.") }
        }
    }

    private fun completeEmailLink(email: String, emailLink: String) {
        val credential = EmailAuthProvider.getCredentialWithLink(email, emailLink)
        val linkToCurrentUser = preferences.getBoolean("pending_email_link", false)
        val task = if (linkToCurrentUser) {
            val current = auth.currentUser
            if (current == null) {
                showAuthError(IllegalStateException("No signed-in account."), "Sign in before linking email.")
                return
            }
            current.linkWithCredential(credential)
        } else {
            auth.signInWithCredential(credential)
        }
        task.addOnSuccessListener {
            preferences.edit().remove("pending_email").remove("pending_email_link").apply()
            refreshAccount(forceTokenRefresh = true)
        }.addOnFailureListener {
            showAuthError(it, if (linkToCurrentUser) "Email login could not be linked." else "The email sign-in link is invalid or expired.")
        }
    }

    private fun promptForEmail(
        title: String,
        message: String,
        positiveLabel: String,
        onEmail: (String) -> Unit
    ) {
        val input = EditText(activity).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            hint = "you@example.com"
            setSingleLine(true)
        }
        val dialog = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(message)
            .setView(input)
            .setPositiveButton(positiveLabel, null)
            .setNegativeButton("Cancel", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val email = input.text.toString().trim().lowercase()
                if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                    input.error = "Enter a valid email address."
                    return@setOnClickListener
                }
                dialog.dismiss()
                onEmail(email)
            }
        }
        dialog.show()
    }

    private fun refreshAccount(forceTokenRefresh: Boolean) {
        if (auth.currentUser == null) {
            publishSignedOut()
            return
        }
        executor.execute {
            try {
                val user = auth.currentUser ?: throw IllegalStateException("The account signed out.")
                cachedIdToken = Tasks.await(user.getIdToken(forceTokenRefresh)).token.orEmpty()
                if (cachedIdToken.isBlank()) throw IllegalStateException("Firebase did not return an ID token.")
                val account = api("/api/v1/me", "GET", null)
                val accountToken = api("/api/v1/store-account-token", "GET", null)
                    .getString("storeAccountToken")
                UUID.fromString(accountToken)
                cachedStoreAccountToken = accountToken
                publishEntitlements(account.optJSONObject("entitlements"), account)
                evaluate("window.WLAccountEntitlements?._nativeToken?.(" + JSONObject.quote(cachedIdToken) + ")")
            } catch (error: Exception) {
                Log.w(tag, "Account refresh failed: ${error.javaClass.simpleName}")
                val restored = restoreOfflineLease(auth.currentUser)
                if (restored) {
                    evaluate("window.dispatchEvent(new CustomEvent('wl-account-offline'))")
                } else {
                    evaluate(
                        "window.dispatchEvent(new CustomEvent('wl-account-error',{detail:{message:" +
                            JSONObject.quote(safeMessage(error, "WonderLang could not refresh this account.")) + "}}))"
                    )
                }
            }
        }
    }

    private fun publishEntitlements(
        entitlements: JSONObject?,
        fullResponse: JSONObject,
        saveOfflineLease: Boolean = true
    ) {
        if (entitlements == null) throw IllegalStateException("The entitlement response was incomplete.")
        val currentUid = auth.currentUser?.uid
            ?: throw IllegalStateException("The account signed out before access could be published.")
        val responseUid = fullResponse.optString("uid")
        require(responseUid.isBlank() || responseUid == currentUid) {
            "The entitlement response belongs to a different account."
        }
        val platforms = entitlements.optJSONArray("mobilePlatforms")
        val androidGranted = platforms != null && (0 until platforms.length()).any {
            platforms.optString(it).equals("android", ignoreCase = true)
        }
        fullGameEntitled = entitlements.optBoolean("fullGame", false) && androidGranted
        cloudSaveEntitled = entitlements.optBoolean("cloudSave", false) && androidGranted
        val verifiedAtWallMs = parseIsoTimestamp(entitlements.optString("computedAt"))
            ?: System.currentTimeMillis()
        entitlementVerifiedAtWallMs = verifiedAtWallMs
        entitlementVerifiedAtElapsedMs = SystemClock.elapsedRealtime()
        entitlementVerifiedBootCount = currentBootCount()
        entitlementLeaseMaximumAgeMs = offlineLeaseMaximumAge(entitlements)
        entitlementLeaseExpiresAtWallMs = if (fullGameEntitled) {
            offlineLeaseExpiry(entitlements, verifiedAtWallMs)
        } else {
            0L
        }
        cachedAccountUid = currentUid
        cachedAccountJson = fullResponse.toString()
        if (saveOfflineLease) persistOfflineLease(entitlements)
        evaluate(
            "window.WLAccountEntitlements?._nativeAccount?.(" +
                JSONObject.quote(fullResponse.toString()) + ")"
        )
    }

    /**
     * Keep a bounded, device-keystore-encrypted lease so a verified player is not
     * locked out merely because the app restarted without a network connection.
     * The lease is tied to the Firebase UID, never contains an ID/refresh token,
     * rejects wall-clock rollback, and can never outlive a subscription/grace end.
     */
    private fun persistOfflineLease(entitlements: JSONObject) {
        val user = auth.currentUser ?: return
        val platforms = entitlements.optJSONArray("mobilePlatforms")
        val androidGranted = platforms != null && (0 until platforms.length()).any {
            platforms.optString(it).equals("android", ignoreCase = true)
        }
        if (!entitlements.optBoolean("fullGame", false) || !androidGranted) {
            clearOfflineLease()
            return
        }

        val nowWallMs = System.currentTimeMillis()
        val verifiedAtWallMs = parseIsoTimestamp(entitlements.optString("computedAt")) ?: nowWallMs
        val lease = JSONObject()
            .put("schema", OFFLINE_LEASE_SCHEMA)
            .put("uid", user.uid)
            .put("verifiedAtWallMs", verifiedAtWallMs)
            .put("verifiedAtElapsedMs", SystemClock.elapsedRealtime())
            .put("bootCount", currentBootCount())
            .put("expiresAtWallMs", offlineLeaseExpiry(entitlements, verifiedAtWallMs))
            .put("entitlements", JSONObject(entitlements.toString()))

        runCatching { encryptOfflineLease(lease.toString()) }
            .onSuccess { encrypted ->
                offlineLeasePreferences.edit().putString(OFFLINE_LEASE_VALUE, encrypted).apply()
            }
            .onFailure {
                Log.w(tag, "Offline entitlement lease could not be stored: ${it.javaClass.simpleName}")
                clearOfflineLease()
            }
    }

    private fun restoreOfflineLease(user: FirebaseUser?): Boolean {
        if (user == null) return false
        val encrypted = offlineLeasePreferences.getString(OFFLINE_LEASE_VALUE, "").orEmpty()
        if (encrypted.isBlank()) return false
        return try {
            val lease = JSONObject(decryptOfflineLease(encrypted))
            val nowWallMs = System.currentTimeMillis()
            val nowElapsedMs = SystemClock.elapsedRealtime()
            val verifiedAtWallMs = lease.getLong("verifiedAtWallMs")
            val verifiedAtElapsedMs = lease.getLong("verifiedAtElapsedMs")
            val storedBootCount = lease.optInt("bootCount", -1)
            val sameBoot = storedBootCount >= 0 && storedBootCount == currentBootCount()

            require(lease.optInt("schema") == OFFLINE_LEASE_SCHEMA)
            require(lease.getString("uid") == user.uid)
            require(nowWallMs + OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS >= verifiedAtWallMs)
            require(!sameBoot || nowElapsedMs >= verifiedAtElapsedMs)

            val wallAgeMs = (nowWallMs - verifiedAtWallMs).coerceAtLeast(0L)
            val trustedAgeMs = if (sameBoot) {
                maxOf(wallAgeMs, nowElapsedMs - verifiedAtElapsedMs)
            } else {
                wallAgeMs
            }
            val expiresAtWallMs = lease.getLong("expiresAtWallMs")
            require(trustedAgeMs <= offlineLeaseMaximumAge(lease.getJSONObject("entitlements")))
            require(nowWallMs < expiresAtWallMs)

            val entitlements = lease.getJSONObject("entitlements")
            val account = JSONObject()
                .put("uid", user.uid)
                .put("email", user.email ?: JSONObject.NULL)
                .put("entitlements", JSONObject(entitlements.toString()))
                .put("offline", true)
                .put(
                    "cloudSave",
                    JSONObject()
                        .put("enabled", entitlements.optBoolean("cloudSave", false))
                        .put("retainedWhenAccessEnds", true)
                )
            publishEntitlements(entitlements, account, saveOfflineLease = false)
            entitlementVerifiedAtWallMs = verifiedAtWallMs
            entitlementVerifiedAtElapsedMs = verifiedAtElapsedMs
            entitlementVerifiedBootCount = storedBootCount
            entitlementLeaseMaximumAgeMs = offlineLeaseMaximumAge(entitlements)
            entitlementLeaseExpiresAtWallMs = expiresAtWallMs
            true
        } catch (error: Exception) {
            Log.w(tag, "Offline entitlement lease rejected: ${error.javaClass.simpleName}")
            clearOfflineLease()
            false
        }
    }

    private fun offlineLeaseMaximumAge(entitlements: JSONObject): Long =
        if (entitlements.optString("accessKind") == "subscription") {
            OFFLINE_SUBSCRIPTION_MAX_AGE_MS
        } else {
            OFFLINE_PERMANENT_MAX_AGE_MS
        }

    private fun offlineLeaseExpiry(entitlements: JSONObject, verifiedAtWallMs: Long): Long {
        var expiry = verifiedAtWallMs + offlineLeaseMaximumAge(entitlements)
        if (entitlements.optString("accessKind") == "subscription") {
            val providerExpiry = if (entitlements.optString("subscriptionState") == "grace") {
                entitlements.optString("graceEndsAt")
            } else {
                entitlements.optString("subscriptionEndsAt")
            }
            val parsedProviderExpiry = parseIsoTimestamp(providerExpiry)
            if (parsedProviderExpiry != null) expiry = minOf(expiry, parsedProviderExpiry)
        }
        return expiry
    }

    private fun parseIsoTimestamp(value: String): Long? {
        if (value.isBlank()) return null
        return runCatching {
            android.icu.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US).apply {
                isLenient = false
                timeZone = TimeZone.getTimeZone("UTC")
            }.parse(value)?.time
        }.getOrNull()
    }

    private fun currentBootCount(): Int = runCatching {
        Settings.Global.getInt(activity.contentResolver, Settings.Global.BOOT_COUNT)
    }.getOrDefault(-1)

    private fun offlineSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(OFFLINE_LEASE_KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                OFFLINE_LEASE_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private fun encryptOfflineLease(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, offlineSecretKey())
        return JSONObject()
            .put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put(
                "ciphertext",
                Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
            )
            .toString()
    }

    private fun decryptOfflineLease(value: String): String {
        val envelope = JSONObject(value)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            offlineSecretKey(),
            GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP))
        )
        return cipher.doFinal(
            Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
        ).toString(Charsets.UTF_8)
    }

    private fun clearOfflineLease() {
        offlineLeasePreferences.edit().remove(OFFLINE_LEASE_VALUE).apply()
    }

    private fun publishSignedOut() {
        clearCachedAccountState(clearLease = true)
        evaluate("window.WLAccountEntitlements?._nativeSignedOut?.()")
    }

    private fun clearCachedAccountState(clearLease: Boolean) {
        cachedIdToken = ""
        cachedStoreAccountToken = ""
        cachedAccountJson = ""
        cachedAccountUid = ""
        fullGameEntitled = false
        cloudSaveEntitled = false
        entitlementLeaseExpiresAtWallMs = 0L
        entitlementVerifiedAtWallMs = 0L
        entitlementVerifiedAtElapsedMs = 0L
        entitlementVerifiedBootCount = -1
        entitlementLeaseMaximumAgeMs = 0L
        if (clearLease) clearOfflineLease()
    }

    private fun hasValidEntitlementLease(): Boolean {
        if (cachedAccountUid.isBlank() || cachedAccountUid != auth.currentUser?.uid) {
            clearCachedAccountState(clearLease = true)
            return false
        }
        if (!fullGameEntitled) return false
        val nowWallMs = System.currentTimeMillis()
        val nowElapsedMs = SystemClock.elapsedRealtime()
        val expiresAt = entitlementLeaseExpiresAtWallMs
        val sameBoot = entitlementVerifiedBootCount >= 0 &&
            entitlementVerifiedBootCount == currentBootCount()
        val wallAgeMs = (nowWallMs - entitlementVerifiedAtWallMs).coerceAtLeast(0L)
        val trustedAgeMs = if (sameBoot) {
            maxOf(wallAgeMs, nowElapsedMs - entitlementVerifiedAtElapsedMs)
        } else {
            wallAgeMs
        }
        val runtimeLeaseIsValid =
            nowWallMs + OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS >= entitlementVerifiedAtWallMs &&
                (!sameBoot || nowElapsedMs >= entitlementVerifiedAtElapsedMs) &&
                entitlementLeaseMaximumAgeMs > 0L &&
                trustedAgeMs <= entitlementLeaseMaximumAgeMs &&
                expiresAt > 0L &&
                nowWallMs < expiresAt
        if (runtimeLeaseIsValid) return true
        fullGameEntitled = false
        cloudSaveEntitled = false
        entitlementLeaseExpiresAtWallMs = 0L
        entitlementVerifiedAtWallMs = 0L
        entitlementVerifiedAtElapsedMs = 0L
        entitlementVerifiedBootCount = -1
        entitlementLeaseMaximumAgeMs = 0L
        clearOfflineLease()
        cachedAccountJson = runCatching {
            val account = JSONObject(cachedAccountJson)
            val entitlements = account.optJSONObject("entitlements") ?: JSONObject()
            entitlements
                .put("fullGame", false)
                .put("allLanguages", false)
                .put("cloudSave", false)
                .put("offlineExpired", true)
            account.put("entitlements", entitlements).toString()
        }.getOrDefault(cachedAccountJson)
        if (cachedAccountJson.isNotBlank()) {
            evaluate(
                "window.WLAccountEntitlements?._nativeAccount?.(" +
                    JSONObject.quote(cachedAccountJson) + ")"
            )
        }
        return false
    }

    private fun currentUserLabel(user: FirebaseUser?): String =
        user?.email ?: user?.displayName ?: "WonderLang account"

    private fun showAuthError(error: Exception, fallback: String) {
        Log.w(tag, "$fallback (${error.javaClass.simpleName})")
        activity.runOnUiThread {
            AlertDialog.Builder(activity)
                .setTitle("Account not changed")
                .setMessage(safeMessage(error, fallback))
                .setPositiveButton("OK", null)
                .show()
        }
    }

    private fun api(path: String, method: String, body: JSONObject?): JSONObject {
        val user = auth.currentUser ?: throw IllegalStateException("Sign in to WonderLang first.")
        val token = Tasks.await(user.getIdToken(false)).token.orEmpty()
        if (token.isBlank()) throw IllegalStateException("Firebase sign-in needs to be refreshed.")
        cachedIdToken = token
        val appCheckToken = runCatching {
            Tasks.await(appCheck.getAppCheckToken(false), 4, TimeUnit.SECONDS).token.orEmpty()
        }.getOrDefault("")
        val connection = URL(apiBase + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 20_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer $token")
            if (appCheckToken.isNotBlank()) {
                connection.setRequestProperty("X-Firebase-AppCheck", appCheckToken)
            }
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            if (body != null) {
                connection.doOutput = true
                connection.outputStream.use { stream ->
                    stream.write(body.toString().toByteArray(Charsets.UTF_8))
                }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) {
                val serverMessage = runCatching { JSONObject(text).optString("error") }.getOrNull()
                throw IllegalStateException(serverMessage?.takeIf { it.isNotBlank() } ?: "Account service returned HTTP $code.")
            }
            JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun safeMessage(error: Exception, fallback: String): String {
        val raw = error.message?.trim().orEmpty()
        return if (raw.isBlank()) fallback else raw.take(300)
    }

    private fun evaluate(script: String) {
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) {
                webView.evaluateJavascript(script, null)
            }
        }
    }

    private companion object {
        const val ENTITLEMENT_FIREBASE_APP_NAME = "wonderlang-accounts"
        const val OFFLINE_LEASE_SCHEMA = 1
        const val OFFLINE_LEASE_VALUE = "encrypted_lease_v1"
        const val OFFLINE_LEASE_KEY_ALIAS = "wonderlang_entitlement_offline_lease_v1"
        const val OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000L
        const val OFFLINE_SUBSCRIPTION_MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000L
        const val OFFLINE_PERMANENT_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000L
    }
}
