// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package com.plugin.admob

import android.app.Activity
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.gms.ads.rewarded.RewardedAd
import com.google.android.gms.ads.rewarded.RewardedAdLoadCallback
import com.google.android.gms.ads.rewarded.ServerSideVerificationOptions

/** Value of the `stage` field of `*-failed` events for load failures. */
private const val STAGE_LOAD = "load"

/** Value of the `stage` field of `*-failed` events for show failures. */
private const val STAGE_SHOW = "show"

/**
 * Builds a [FullScreenContentCallback] that forwards the five SDK callbacks to
 * the given lambdas. Shared by the interstitial and rewarded managers.
 */
private fun buildFullScreenCallback(
    onOpened: () -> Unit,
    onImpression: () -> Unit,
    onClicked: () -> Unit,
    onDismissed: () -> Unit,
    onShowFailed: (AdError) -> Unit
): FullScreenContentCallback = object : FullScreenContentCallback() {
    override fun onAdShowedFullScreenContent() = onOpened()
    override fun onAdImpression() = onImpression()
    override fun onAdClicked() = onClicked()
    override fun onAdDismissedFullScreenContent() = onDismissed()
    override fun onAdFailedToShowFullScreenContent(adError: AdError) = onShowFailed(adError)
}

/**
 * Builds the payload of the `*-failed` events from an SDK error.
 */
private fun adFailedPayload(adUnitId: String, stage: String, error: AdError): JSObject = JSObject()
    .put("adUnitId", adUnitId)
    .put("stage", stage)
    .put("code", error.code.toString())
    .put("message", error.message)
    .put("domain", error.domain)

/**
 * Owns the loaded [InterstitialAd] and drives its full-screen lifecycle.
 *
 * All methods must be called from the UI thread (the AdMob SDK delivers its
 * callbacks on the main thread, and the plugin hops to the UI thread before
 * entering this class), so no synchronization is required.
 *
 * @param activity the foreground activity used to load and present the ad
 * @param notifyEvent called with (event name, payload) for every SDK event
 */
internal class InterstitialManager(
    private val activity: Activity,
    private val notifyEvent: (event: String, payload: JSObject) -> Unit
) {
    /** Currently stored ad with its ad unit ID, or `null` when nothing is loaded. */
    private var loaded: Pair<InterstitialAd, String>? = null

    /** `true` between a successful `show` and the dismissal/show-failure callback. */
    private var isShowing = false

    /**
     * Bumped on every teardown ([destroy]). Load callbacks created with an
     * older epoch are stale (their command was superseded by a destroy or a
     * newer load) and complete silently without touching the stored state.
     */
    private var loadEpoch = 0L

    /**
     * Loads a fresh interstitial. Concurrent loads are allowed: the newest
     * successful load replaces the stored one.
     *
     * Resolves the [Invoke] exactly once, either here or from a stale branch
     * (the load command completed, its result was simply discarded).
     */
    fun load(adUnitId: String, invoke: Invoke) {
        loadEpoch += 1
        val epoch = loadEpoch
        InterstitialAd.load(
            activity,
            adUnitId,
            AdRequest.Builder().build(),
            object : InterstitialAdLoadCallback() {
                override fun onAdLoaded(loadedAd: InterstitialAd) {
                    activity.runOnUiThread {
                        if (epoch != loadEpoch) {
                            invoke.resolve()
                            return@runOnUiThread
                        }
                        loaded = loadedAd to adUnitId
                        notifyEvent(
                            AdmobEvents.INTERSTITIAL_LOADED,
                            JSObject().put("adUnitId", adUnitId)
                        )
                        invoke.resolve()
                    }
                }

                override fun onAdFailedToLoad(loadError: LoadAdError) {
                    activity.runOnUiThread {
                        if (epoch != loadEpoch) {
                            invoke.resolve()
                            return@runOnUiThread
                        }
                        notifyEvent(
                            AdmobEvents.INTERSTITIAL_FAILED,
                            adFailedPayload(adUnitId, STAGE_LOAD, loadError)
                        )
                        invoke.reject(
                            "interstitial load failed: ${loadError.message}",
                            AdmobRejectCodes.LOAD_FAILED
                        )
                    }
                }
            }
        )
    }

    /**
     * Shows the stored interstitial. Registers the full-screen content
     * callbacks BEFORE presenting and resolves/rejects the [Invoke] exactly
     * once from the dismissal or show-failure callback.
     */
    fun show(invoke: Invoke) {
        val current = loaded
        if (current == null) {
            invoke.reject("no interstitial loaded", AdmobRejectCodes.AD_NOT_READY)
            return
        }
        if (isShowing) {
            invoke.reject("an interstitial show is already in progress", AdmobRejectCodes.AD_NOT_READY)
            return
        }

        isShowing = true
        val (currentAd, currentAdUnitId) = current

        currentAd.fullScreenContentCallback = buildFullScreenCallback(
            onOpened = {
                notifyEvent(
                    AdmobEvents.INTERSTITIAL_OPENED,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
            },
            onImpression = {
                notifyEvent(
                    AdmobEvents.INTERSTITIAL_IMPRESSION,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
            },
            onClicked = {
                notifyEvent(
                    AdmobEvents.INTERSTITIAL_CLICKED,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
            },
            onDismissed = {
                isShowing = false
                // Only clear the stored reference if it still points at the
                // ad that was shown: a newer load may have replaced it.
                if (loaded?.first === currentAd) {
                    loaded = null
                }
                notifyEvent(
                    AdmobEvents.INTERSTITIAL_CLOSED,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
                invoke.resolve()
            },
            onShowFailed = { adError ->
                isShowing = false
                if (loaded?.first === currentAd) {
                    loaded = null
                }
                notifyEvent(
                    AdmobEvents.INTERSTITIAL_FAILED,
                    adFailedPayload(currentAdUnitId, STAGE_SHOW, adError)
                )
                invoke.reject(
                    "interstitial failed to show: ${adError.message}",
                    AdmobRejectCodes.SHOW_FAILED
                )
            }
        )

        currentAd.show(activity)
    }

    /** Clears the stored ad and listeners. Safe to call at any time. */
    fun destroy() {
        loadEpoch += 1
        loaded = null
    }
}

/**
 * Owns the loaded [RewardedAd] and drives its full-screen lifecycle. Mirrors
 * [InterstitialManager] with the additional SDK reward callback.
 *
 * All methods must be called from the UI thread.
 *
 * @param activity the foreground activity used to load and present the ad
 * @param notifyEvent called with (event name, payload) for every SDK event
 */
internal class RewardedManager(
    private val activity: Activity,
    private val notifyEvent: (event: String, payload: JSObject) -> Unit
) {
    /** Currently stored ad with its ad unit ID, or `null` when nothing is loaded. */
    private var loaded: Pair<RewardedAd, String>? = null

    /** `true` between a successful `show` and the dismissal/show-failure callback. */
    private var isShowing = false

    /** Staleness guard, see [InterstitialManager.loadEpoch]. */
    private var loadEpoch = 0L

    /**
     * Loads a fresh rewarded ad. Concurrent loads are allowed: the newest
     * successful load replaces the stored one.
     *
     * Resolves the [Invoke] exactly once, either here or from a stale branch.
     */
    fun load(adUnitId: String, invoke: Invoke) {
        loadEpoch += 1
        val epoch = loadEpoch
        RewardedAd.load(
            activity,
            adUnitId,
            AdRequest.Builder().build(),
            object : RewardedAdLoadCallback() {
                override fun onAdLoaded(loadedAd: RewardedAd) {
                    activity.runOnUiThread {
                        if (epoch != loadEpoch) {
                            invoke.resolve()
                            return@runOnUiThread
                        }
                        loaded = loadedAd to adUnitId
                        notifyEvent(
                            AdmobEvents.REWARDED_LOADED,
                            JSObject().put("adUnitId", adUnitId)
                        )
                        invoke.resolve()
                    }
                }

                override fun onAdFailedToLoad(loadError: LoadAdError) {
                    activity.runOnUiThread {
                        if (epoch != loadEpoch) {
                            invoke.resolve()
                            return@runOnUiThread
                        }
                        notifyEvent(
                            AdmobEvents.REWARDED_FAILED,
                            adFailedPayload(adUnitId, STAGE_LOAD, loadError)
                        )
                        invoke.reject(
                            "rewarded load failed: ${loadError.message}",
                            AdmobRejectCodes.LOAD_FAILED
                        )
                    }
                }
            }
        )
    }

    /**
     * Shows the stored rewarded ad. Registers the full-screen content
     * callbacks BEFORE presenting and resolves/rejects the [Invoke] exactly
     * once from the dismissal or show-failure callback.
     *
     * The reward is ALWAYS delivered by the real SDK callback
     * (`OnUserEarnedRewardListener`) through the `admob://rewarded-earned`
     * event — never synthesized from the dismissal.
     */
    fun show(userId: String? = null, customData: String? = null, invoke: Invoke) {
        val current = loaded
        if (current == null) {
            invoke.reject("no rewarded ad loaded", AdmobRejectCodes.AD_NOT_READY)
            return
        }
        if (isShowing) {
            invoke.reject("a rewarded show is already in progress", AdmobRejectCodes.AD_NOT_READY)
            return
        }

        isShowing = true
        val (currentAd, currentAdUnitId) = current

        if (!userId.isNullOrEmpty() || !customData.isNullOrEmpty()) {
            val optionsBuilder = ServerSideVerificationOptions.Builder()
            if (!userId.isNullOrEmpty()) {
                optionsBuilder.setUserId(userId)
            }
            if (!customData.isNullOrEmpty()) {
                optionsBuilder.setCustomData(customData)
            }
            currentAd.setServerSideVerificationOptions(optionsBuilder.build())
        }

        currentAd.fullScreenContentCallback = buildFullScreenCallback(
            onOpened = {
                notifyEvent(
                    AdmobEvents.REWARDED_OPENED,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
            },
            onImpression = {
                notifyEvent(
                    AdmobEvents.REWARDED_IMPRESSION,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
            },
            onClicked = {
                notifyEvent(
                    AdmobEvents.REWARDED_CLICKED,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
            },
            onDismissed = {
                isShowing = false
                if (loaded?.first === currentAd) {
                    loaded = null
                }
                notifyEvent(
                    AdmobEvents.REWARDED_CLOSED,
                    JSObject().put("adUnitId", currentAdUnitId)
                )
                invoke.resolve()
            },
            onShowFailed = { adError ->
                isShowing = false
                if (loaded?.first === currentAd) {
                    loaded = null
                }
                notifyEvent(
                    AdmobEvents.REWARDED_FAILED,
                    adFailedPayload(currentAdUnitId, STAGE_SHOW, adError)
                )
                invoke.reject(
                    "rewarded failed to show: ${adError.message}",
                    AdmobRejectCodes.SHOW_FAILED
                )
            }
        )

        currentAd.show(activity) { reward ->
            // Real SDK reward delivery (OnUserEarnedRewardListener):
            // `reward.amount` is an Int and `reward.type` a String.
            notifyEvent(
                AdmobEvents.REWARDED_EARNED,
                JSObject()
                    .put("adUnitId", currentAdUnitId)
                    .put("amount", reward.amount)
                    .put("type", reward.type)
            )
        }
    }

    /** Clears the stored ad and listeners. Safe to call at any time. */
    fun destroy() {
        loadEpoch += 1
        loaded = null
    }
}
