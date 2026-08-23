package com.wonderlang.entitlement

import android.app.Activity
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Clean-room bridge for the duplicate Android integration. It contains no game assets or
 * production MainActivity source. Attach it with webView.addJavascriptInterface(..., "WLAccountManager").
 */
class WonderLangAccountBridge(
    private val activity: Activity,
    private val webView: WebView,
    private val apiBaseUrl: String,
    private val signInCoordinator: SignInCoordinator
) {
    interface SignInCoordinator {
        fun openSignIn()
    }

    private val auth = FirebaseAuth.getInstance()
    private val executor = Executors.newSingleThreadExecutor()
    @Volatile private var cachedIdToken: String = ""

    init {
        auth.addAuthStateListener { firebaseAuth ->
            if (firebaseAuth.currentUser == null) {
                cachedIdToken = ""
                evaluate("window.WLAccountEntitlements?._nativeSignedOut?.()")
            } else refreshIdToken()
        }
    }

    @JavascriptInterface
    fun getCachedIdToken(): String = cachedIdToken

    @JavascriptInterface
    fun openSignIn(): Boolean {
        activity.runOnUiThread { signInCoordinator.openSignIn() }
        return true
    }

    @JavascriptInterface
    fun refreshIdToken(): Boolean {
        val user = auth.currentUser ?: return false.also {
            evaluate("window.WLAccountEntitlements?._nativeToken?.('')")
        }
        user.getIdToken(false)
            .addOnSuccessListener { result ->
                cachedIdToken = result.token.orEmpty()
                evaluate("window.WLAccountEntitlements?._nativeToken?.(${JSONObject.quote(cachedIdToken)})")
            }
            .addOnFailureListener {
                cachedIdToken = ""
                evaluate("window.WLAccountEntitlements?._nativeToken?.('')")
            }
        return true
    }

    /** Call for every PURCHASED Play callback and restore result; the server verifies and acknowledges. */
    fun claimGooglePlayPurchase(kind: String, productId: String, purchaseToken: String) {
        executor.execute {
            val body = JSONObject()
                .put("kind", kind)
                .put("productId", productId)
                .put("purchaseToken", purchaseToken)
            val result = api("/api/v1/google-play/claim", "POST", body)
            evaluate("window.WLAccountEntitlements?._nativePurchaseVerified?.(${JSONObject.quote(result.toString())})")
        }
    }

    /** Fetch once after sign-in and pass this UUID to BillingFlowParams.setObfuscatedAccountId. */
    fun fetchStoreAccountToken(onResult: (String) -> Unit) {
        executor.execute {
            val token = api("/api/v1/store-account-token", "GET", null).getString("storeAccountToken")
            activity.runOnUiThread { onResult(token) }
        }
    }

    private fun api(path: String, method: String, body: JSONObject?): JSONObject {
        val idToken = cachedIdToken.ifBlank { throw IllegalStateException("Firebase sign-in is required") }
        val connection = URL(apiBaseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("Authorization", "Bearer $idToken")
        connection.setRequestProperty("Content-Type", "application/json")
        if (body != null) {
            connection.doOutput = true
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        }
        val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
        val text = stream.bufferedReader().use { it.readText() }
        if (connection.responseCode !in 200..299) throw IllegalStateException("Account API ${connection.responseCode}: $text")
        return JSONObject(text)
    }

    private fun evaluate(script: String) {
        activity.runOnUiThread { webView.evaluateJavascript(script, null) }
    }
}
