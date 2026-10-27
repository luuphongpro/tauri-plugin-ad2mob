// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package com.plugin.admob

import app.tauri.annotation.InvokeArg
import com.fasterxml.jackson.annotation.JsonProperty

/**
 * Argument classes for the `@Command` methods of [AdmobPlugin], deserialized
 * by Jackson through `Invoke.parseArgs`.
 *
 * The Tauri runtime configures Jackson with field visibility `ANY`, so every
 * property maps by its backing-field name. Nullable fields are validated
 * defensively by the plugin (missing values are rejected with
 * `INVALID_ARGUMENT` instead of failing late inside the SDK).
 */

/** Arguments of `initialize`. All fields mirror the Rust payload camelCase. */
@InvokeArg
class InitializeArgs {
    var appId: String? = null

    /**
     * Explicit JSON name: Kotlin generates the getter `isTesting()` for a
     * property named `isTesting`, which Jackson would otherwise read as the
     * property `testing`.
     */
    @JsonProperty("isTesting")
    var isTesting: Boolean = false

    var automaticallyRequestConsent: Boolean = false

    /** iOS App Tracking Transparency flag; ignored on Android. */
    var requestTrackingAuthorization: Boolean = false

    var debug: Boolean = false
}

/** Arguments of `loadInterstitial` / `loadRewarded`. */
@InvokeArg
class LoadAdArgs {
    var adUnitId: String? = null
}

/** Arguments of `showRewarded`. */
@InvokeArg
class ShowRewardedArgs {
    var userId: String? = null
    var customData: String? = null
}

/** Arguments of `showBanner`. */
@InvokeArg
class ShowBannerArgs {
    var adUnitId: String? = null

    /** `"top"` or `"bottom"` (parsed by [parseBannerPosition]). */
    var position: String? = null

    /** One of the six banner size names (parsed by [parseBannerSize]). */
    var size: String? = null
}

/** Arguments of `setBannerPosition`. */
@InvokeArg
class SetBannerPositionArgs {
    /** `"top"` or `"bottom"` (parsed by [parseBannerPosition]). */
    var position: String? = null
}
