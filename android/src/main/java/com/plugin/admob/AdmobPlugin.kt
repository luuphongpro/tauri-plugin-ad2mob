// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package com.plugin.admob

import android.app.Activity
import android.content.pm.PackageManager
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.ads.MobileAds

/** Log tag used for the plugin's own warnings and debug output. */
private const val TAG = "TauriAdmob"

/** Manifest meta-data key that must hold the app-level AdMob App ID. */
private const val MANIFEST_APP_ID_META_DATA = "com.google.android.gms.ads.APPLICATION_ID"

/**
 * Tauri v2 mobile plugin entry point for Google AdMob on Android.
 *
 * Registered from the Rust core via
 * `register_android_plugin("com.plugin.admob", "AdmobPlugin")`. Every command
 * hops to the UI thread before touching the AdMob SDK, the view hierarchy or
 * the event channel; `resolve`/`reject` happen exactly once per command.
 */
@TauriPlugin
class AdmobPlugin(private val activity: Activity) : Plugin(activity) {

    private val consentManager = ConsentManager(activity)
    private val bannerManager = BannerManager(activity) { event, payload -> trigger(event, payload) }
    private val interstitialManager =
        InterstitialManager(activity) { event, payload -> trigger(event, payload) }
    private val rewardedManager =
        RewardedManager(activity) { event, payload -> trigger(event, payload) }

    /** Set by the first successful `initialize`; lets a repeated call no-op. */
    private var initialized = false

    /** Enables verbose native logging (never logs personal data). */
    private var isDebug = false

    /** Last consent status reported through `initialize` / `requestConsent`. */
    private var lastConsentStatus = CONSENT_STATUS_UNKNOWN

    // ------------------------------------------------------------------
    // Commands
    // ------------------------------------------------------------------

    /**
     * Validates the manifest AdMob App ID, starts the Mobile Ads SDK, runs
     * the UMP consent flow when requested, triggers `admob://initialized` and
     * resolves `{ consentStatus, trackingStatus }`.
     */
    @Command
    fun initialize(invoke: Invoke) {
        val args = invoke.parseArgs(InitializeArgs::class.java)
        activity.runOnUiThread { handleInitialize(args, invoke) }
    }

    /** Runs the UMP consent flow and resolves `{ status }`. */
    @Command
    fun requestConsent(invoke: Invoke) {
        activity.runOnUiThread {
            consentManager.request { consentStatus, formError ->
                if (formError != null) {
                    Log.w(TAG, "consent request failed: ${formError.message}")
                    invoke.reject(
                        "consent request failed: ${formError.message}",
                        AdmobRejectCodes.NATIVE_ERROR
                    )
                } else {
                    val status = mapConsentStatus(consentStatus)
                    lastConsentStatus = status
                    trigger(AdmobEvents.CONSENT_CHANGED, JSObject().put("status", status))
                    invoke.resolve(JSObject().put("status", status))
                }
            }
        }
    }

    /**
     * Android has no App Tracking Transparency equivalent: resolves
     * `{ status: "notAvailable" }` without triggering any event.
     */
    @Command
    fun requestTrackingAuthorization(invoke: Invoke) {
        activity.runOnUiThread {
            invoke.resolve(JSObject().put("status", TRACKING_STATUS_NOT_AVAILABLE))
        }
    }

    /** Loads a fresh interstitial for `adUnitId`. */
    @Command
    fun loadInterstitial(invoke: Invoke) {
        val args = invoke.parseArgs(LoadAdArgs::class.java)
        val adUnitId = args.adUnitId
        if (adUnitId.isNullOrBlank()) {
            invoke.reject(
                "loadInterstitial requires a non-empty adUnitId argument",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }
        debugLog("loading interstitial")
        activity.runOnUiThread { interstitialManager.load(adUnitId, invoke) }
    }

    /** Shows the stored interstitial; resolves once it is dismissed. */
    @Command
    fun showInterstitial(invoke: Invoke) {
        activity.runOnUiThread { interstitialManager.show(invoke) }
    }

    /** Clears the stored interstitial and listeners. */
    @Command
    fun destroyInterstitial(invoke: Invoke) {
        activity.runOnUiThread {
            interstitialManager.destroy()
            invoke.resolve()
        }
    }

    /** Loads a fresh rewarded ad for `adUnitId`. */
    @Command
    fun loadRewarded(invoke: Invoke) {
        val args = invoke.parseArgs(LoadAdArgs::class.java)
        val adUnitId = args.adUnitId
        if (adUnitId.isNullOrBlank()) {
            invoke.reject(
                "loadRewarded requires a non-empty adUnitId argument",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }
        debugLog("loading rewarded ad")
        activity.runOnUiThread { rewardedManager.load(adUnitId, invoke) }
    }

    /** Shows the stored rewarded ad; resolves once it is dismissed. */
    @Command
    fun showRewarded(invoke: Invoke) {
        val args = invoke.parseArgs(ShowRewardedArgs::class.java)
        activity.runOnUiThread { rewardedManager.show(args.userId, args.customData, invoke) }
    }

    /** Clears the stored rewarded ad and listeners. */
    @Command
    fun destroyRewarded(invoke: Invoke) {
        activity.runOnUiThread {
            rewardedManager.destroy()
            invoke.resolve()
        }
    }

    /** Creates, attaches and loads the banner; resolves once the ad loads. */
    @Command
    fun showBanner(invoke: Invoke) {
        val args = invoke.parseArgs(ShowBannerArgs::class.java)
        val adUnitId = args.adUnitId
        if (adUnitId.isNullOrBlank()) {
            invoke.reject(
                "showBanner requires a non-empty adUnitId argument",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }
        val position = parseBannerPosition(args.position)
        if (position == null) {
            invoke.reject(
                "invalid banner position '${args.position}' (expected \"top\" or \"bottom\")",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }
        val size = parseBannerSize(args.size)
        if (size == null) {
            invoke.reject(
                "invalid banner size '${args.size}' (expected banner, largeBanner, " +
                    "mediumRectangle, fullBanner, leaderboard or adaptive)",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }
        debugLog("showing banner ($position, $size)")
        activity.runOnUiThread { bannerManager.show(adUnitId, position, size, invoke) }
    }

    /** Hides the banner, keeping the view alive for a re-show. */
    @Command
    fun hideBanner(invoke: Invoke) {
        activity.runOnUiThread {
            bannerManager.hide()
            invoke.resolve()
        }
    }

    /** Repositions the live banner; no-op when there is none. */
    @Command
    fun setBannerPosition(invoke: Invoke) {
        val args = invoke.parseArgs(SetBannerPositionArgs::class.java)
        val position = parseBannerPosition(args.position)
        if (position == null) {
            invoke.reject(
                "invalid banner position '${args.position}' (expected \"top\" or \"bottom\")",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }
        activity.runOnUiThread {
            bannerManager.setPosition(position)
            invoke.resolve()
        }
    }

    /** Removes and destroys the banner view, clearing every reference. */
    @Command
    fun destroyBanner(invoke: Invoke) {
        activity.runOnUiThread {
            bannerManager.destroy()
            invoke.resolve()
        }
    }

    /** Tears down banner, interstitial and rewarded state. */
    @Command
    fun destroy(invoke: Invoke) {
        activity.runOnUiThread {
            debugLog("destroying AdMob resources")
            bannerManager.destroy()
            interstitialManager.destroy()
            rewardedManager.destroy()
            initialized = false
            lastConsentStatus = CONSENT_STATUS_UNKNOWN
            invoke.resolve()
        }
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * The AdMob SDK keeps banner views current across foreground transitions
     * by itself (recent SDK versions pause/resume `AdView` internally), so
     * `onResume`/`onPause` are intentionally empty.
     */
    override fun onResume() {
    }

    /** See [onResume]: the SDK handles pause/resume internally. */
    override fun onPause() {
    }

    /** Releases the banner and the full-screen ads to avoid leaks. */
    override fun onDestroy(activity: AppCompatActivity) {
        activity.runOnUiThread {
            bannerManager.destroy()
            interstitialManager.destroy()
            rewardedManager.destroy()
            initialized = false
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private fun handleInitialize(args: InitializeArgs, invoke: Invoke) {
        if (initialized) {
            debugLog("initialize called again; already initialized")
            invoke.resolve(initializeResult(lastConsentStatus))
            return
        }

        if (args.appId.isNullOrBlank()) {
            invoke.reject(
                "initialize requires a non-empty appId argument",
                AdmobRejectCodes.INVALID_ARGUMENT
            )
            return
        }

        isDebug = args.debug

        val manifestAppId = manifestAdMobAppId()
        if (manifestAppId.isNullOrBlank()) {
            invoke.reject(
                "Missing AdMob App ID. Add " +
                    "<meta-data android:name=\"com.google.android.gms.ads.APPLICATION_ID\" " +
                    "android:value=\"ca-app-pub-xxxxx~xxxxx\"/> inside the <application> " +
                    "element of AndroidManifest.xml.",
                AdmobRejectCodes.INVALID_CONFIGURATION
            )
            return
        }
        if (manifestAppId != args.appId) {
            // The AdMob SDK always uses the manifest value; warn and continue.
            Log.w(
                TAG,
                "initialize appId '${args.appId}' differs from the manifest value " +
                    "'$manifestAppId'; the AdMob SDK always uses the manifest value"
            )
        }

        debugLog(
            "initializing MobileAds (testing=${args.isTesting}, " +
                "automaticallyRequestConsent=${args.automaticallyRequestConsent})"
        )

        try {
            MobileAds.initialize(activity) {
                if (args.automaticallyRequestConsent) {
                    consentManager.request { consentStatus, formError ->
                        if (formError != null) {
                            Log.w(TAG, "consent flow failed: ${formError.message}")
                            invoke.reject(
                                "consent flow failed: ${formError.message}",
                                AdmobRejectCodes.NATIVE_ERROR
                            )
                        } else {
                            val status = mapConsentStatus(consentStatus)
                            lastConsentStatus = status
                            trigger(
                                AdmobEvents.CONSENT_CHANGED,
                                JSObject().put("status", status)
                            )
                            finishInitialize(args, status, invoke)
                        }
                    }
                } else {
                    val status = mapConsentStatus(consentManager.currentStatus())
                    lastConsentStatus = status
                    finishInitialize(args, status, invoke)
                }
            }
        } catch (error: Exception) {
            invoke.reject(
                "MobileAds initialization failed: ${error.message}",
                AdmobRejectCodes.NATIVE_ERROR
            )
        }
    }

    /**
     * Triggers `admob://initialized` and resolves initialize. On Android
     * `trackingStatus` is always `notAvailable` (no ATT); the tracking event
     * is never triggered from this platform.
     */
    private fun finishInitialize(args: InitializeArgs, consentStatus: String, invoke: Invoke) {
        initialized = true
        trigger(
            AdmobEvents.INITIALIZED,
            JSObject()
                .put("platform", PLATFORM_ANDROID)
                .put("testing", args.isTesting)
        )
        invoke.resolve(initializeResult(consentStatus))
    }

    private fun initializeResult(consentStatus: String): JSObject = JSObject()
        .put("consentStatus", consentStatus)
        .put("trackingStatus", TRACKING_STATUS_NOT_AVAILABLE)

    /**
     * Reads the app-level AdMob App ID from the merged manifest meta-data.
     * Uses the classic `GET_META_DATA` lookup, which works on every supported
     * minSdk (the API 33+ overload is unavailable below Tiramisu).
     */
    private fun manifestAdMobAppId(): String? {
        return try {
            @Suppress("DEPRECATION")
            val appInfo = activity.packageManager.getApplicationInfo(
                activity.packageName,
                PackageManager.GET_META_DATA
            )
            appInfo.metaData?.getString(MANIFEST_APP_ID_META_DATA)
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }
    }

    /** Debug-gated log helper; never called with personal data. */
    private fun debugLog(message: String) {
        if (isDebug) {
            Log.d(TAG, message)
        }
    }
}
