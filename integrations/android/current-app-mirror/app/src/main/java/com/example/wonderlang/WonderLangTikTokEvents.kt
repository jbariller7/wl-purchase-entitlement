package com.wonderlang.app

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import com.tiktok.TikTokBusinessSdk
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Only verified purchase facts cross this boundary; never Play tokens or raw receipts. */
object WonderLangTikTokEvents {
    private var ready = false
    private var initializing = false
    private const val TAG = "WonderLangTikTok"

    @Synchronized fun initialize(context: Context) {
        val app = context.applicationContext
        if (ready) { drain(app); return }
        if (initializing) return
        try {
            val secret = app.getString(R.string.wonderlang_tiktok_app_secret)
            if (secret.isBlank()) return
            initializing = true
            val config = TikTokBusinessSdk.TTConfig(app, secret)
                .setAppId(app.packageName)
                .setTTAppId("7686478792608497685")
                .disableAutoEvents()
                .disableAutoEnhancedDataPostbackEvent()
                .disableAdvertiserIDCollection()
                .disableMonitor()
            // Auto IAP stays off: the entitlement server verifies revenue below.
            if (app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) config.openDebugMode()
            TikTokBusinessSdk.initializeSdk(config, object : TikTokBusinessSdk.TTInitCallback {
                override fun success() { synchronized(this@WonderLangTikTokEvents) {
                    ready = true; initializing = false; drain(app)
                } }
                override fun fail(code: Int, msg: String?) {
                    synchronized(this@WonderLangTikTokEvents) { initializing = false }
                    Log.w(TAG, "SDK initialization unavailable ($code).")
                }
            })
        } catch (error: Exception) {
            initializing = false
            Log.w(TAG, "SDK initialization unavailable.")
        } catch (error: LinkageError) {
            initializing = false
            Log.w(TAG, "SDK initialization unavailable.")
        }
    }

    @Synchronized fun record(context: Context, conversion: JSONObject?, productId: String) {
        if (conversion == null) return
        try {
            val name = conversion.optString("eventName")
            val id = conversion.optString("eventId")
            val value = conversion.optDouble("value", Double.NaN)
            val currency = conversion.optString("currency")
            if (name !in setOf("Purchase", "Subscribe", "StartTrial") || id.isBlank() ||
                !currency.matches(Regex("[A-Z]{3}")) || !value.isFinite() ||
                (name == "StartTrial" && value != 0.0) || (name != "StartTrial" && value <= 0)) return
            val key = MessageDigest.getInstance("SHA-256").digest(id.toByteArray())
                .joinToString("") { "%02x".format(it.toInt() and 255) }
            val prefs = context.getSharedPreferences("wl_tiktok_events", Context.MODE_PRIVATE)
            if (prefs.getBoolean("sent_$key", false)) return
            val safeEvent = JSONObject().put("eventName", name).put("eventId", id)
                .put("value", value).put("currency", currency).put("productId", productId)
            // Persist before SDK initialization completes or the app backgrounds.
            prefs.edit().putString("pending_$key", safeEvent.toString()).apply()
            if (ready) drain(context.applicationContext)
        } catch (error: Exception) { Log.w(TAG, "Purchase reporting deferred.") }
    }

    @Suppress("DEPRECATION")
    @Synchronized private fun drain(context: Context) {
        if (!ready) return
        val prefs = context.getSharedPreferences("wl_tiktok_events", Context.MODE_PRIVATE)
        for ((key, raw) in prefs.all) {
            if (!key.startsWith("pending_") || raw !is String) continue
            try {
                val event = JSONObject(raw)
                val props = JSONObject().put("value", event.getDouble("value"))
                    .put("currency", event.getString("currency"))
                    .put("contents", JSONArray().put(JSONObject()
                        .put("content_id", event.getString("productId"))
                        .put("content_type", "product").put("quantity", 1)
                        .put("price", event.getDouble("value"))))
                TikTokBusinessSdk.trackEvent(event.getString("eventName"), props, event.getString("eventId"))
                prefs.edit().remove(key).putBoolean("sent_" + key.removePrefix("pending_"), true).apply()
            } catch (error: Exception) { Log.w(TAG, "Purchase reporting deferred.") }
        }
        TikTokBusinessSdk.flush()
    }
}
