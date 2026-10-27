# Native contract — Android (Kotlin) & iOS (Swift)

This document is the single source of truth shared by the Rust core, the
TypeScript bindings and both native implementations. All names and payload
shapes are **stable public API**.

## Transport

- Rust calls native methods with `PluginHandle::run_mobile_plugin_async`.
  Method names are **camelCase** and resolve/reject **exactly once**.
- Native rejections MUST be `{ "code": String, "message": String }` and
  nothing else (Tauri deserializes them into `ErrorResponse { code, message }`).
  Embed any SDK detail inside `message`.
- Reject codes: `NOT_INITIALIZED`, `AD_NOT_READY`, `LOAD_FAILED`, `SHOW_FAILED`,
  `INVALID_CONFIGURATION`, `INVALID_ARGUMENT`, `CONSENT_REQUIRED`,
  `UNSUPPORTED_PLATFORM`, `NATIVE_ERROR`.
- Resolves may be `null` unless a result object is specified below.

## Events (native → WebView)

Triggered through the plugin event channel (`Plugin.trigger`), regardless of
whether any JS listener is registered (trigger is a no-op then). Names:

```
admob://initialized                          { platform, testing }
admob://consent-changed                      { status }
admob://tracking-authorization-changed       { status }
admob://banner-loaded                        { adUnitId }
admob://banner-failed                        { adUnitId?, code?, message, domain? }
admob://banner-opened                        { adUnitId? }
admob://banner-clicked                       { adUnitId? }
admob://banner-impression                    { adUnitId? }
admob://banner-closed                        { adUnitId? }
admob://interstitial-loaded                  { adUnitId }
admob://interstitial-failed                  { adUnitId?, code?, message, domain?, stage: "load" | "show" }
admob://interstitial-opened                  { adUnitId? }
admob://interstitial-impression              { adUnitId? }
admob://interstitial-clicked                 { adUnitId? }
admob://interstitial-closed                  { adUnitId? }
admob://rewarded-loaded                      { adUnitId }
admob://rewarded-failed                      { adUnitId?, code?, message, domain?, stage: "load" | "show" }
admob://rewarded-opened                      { adUnitId? }
admob://rewarded-impression                  { adUnitId? }
admob://rewarded-clicked                     { adUnitId? }
admob://rewarded-earned                      { adUnitId?, amount: Number, type: String }
admob://rewarded-closed                      { adUnitId? }
```

`platform` is `"android"` or `"ios"`. Ad Unit IDs in payloads are the ones the
Rust core resolved and passed in (they are never re-derived natively).

## Normalized status strings

- Consent (Google UMP): `unknown`, `required`, `notRequired`, `obtained`.
- Tracking (iOS ATT): `notDetermined`, `restricted`, `denied`, `authorized`.
  Platforms without ATT report `notAvailable`.

## Commands

### `initialize`
Args: `{ appId: string, isTesting: boolean, automaticallyRequestConsent: boolean, requestTrackingAuthorization: boolean, debug: boolean }`

1. `debug` enables verbose native logging. Never log personal data.
2. Validate the app-level AdMob App ID:
   - Android: read `com.google.android.gms.ads.APPLICATION_ID` meta-data from
     the app manifest. Missing → reject `INVALID_CONFIGURATION` with the exact
     `<meta-data>` snippet to add. Present but different from `appId` → log a
     warning and continue (the SDK always uses the manifest value).
   - iOS: read `GADApplicationIdentifier` from `Info.plist`. Missing → reject
     `INVALID_CONFIGURATION` (the SDK aborts without it). Mismatch → warning.
3. Start the SDK (`MobileAds.initialize` / `GADMobileAds.start`).
4. If `automaticallyRequestConsent`: run the UMP flow (consent info update and
   form when required) and track the resulting status.
5. If `requestTrackingAuthorization` (iOS): request ATT authorization.
6. Trigger `admob://initialized` with `{ platform, testing }`.
7. Resolve `{ consentStatus: string, trackingStatus: string }` (normalized
   values; Android always reports `trackingStatus: "notAvailable"`).

### `requestConsent`
Args: none. Runs the UMP consent info update and shows the form when required.
Trigger `admob://consent-changed` `{ status }`. Resolve `{ status }`.
On failure reject `NATIVE_ERROR` with the SDK message.

### `requestTrackingAuthorization`
iOS: run ATT, trigger `admob://tracking-authorization-changed`, resolve
`{ status }`. Android: resolve `{ status: "notAvailable" }` without triggering.

### `loadInterstitial` / `loadRewarded`
Args: `{ adUnitId: string }`. Load a fresh ad (concurrent loads allowed: the
newest successful load replaces the stored one). On success store the ad,
trigger `*-loaded` `{ adUnitId }`, resolve. On failure trigger `*-failed`
with `stage: "load"`, reject `{ code: "LOAD_FAILED", message }`.

### `showInterstitial` / `showRewarded`
Args:
- `showInterstitial`: none.
- `showRewarded`: optional `{ userId?: string, customData?: string }` for Server-Side Verification (SSV).
No stored ad → reject `{ code: "AD_NOT_READY", message }`.
Register the full-screen-content callbacks BEFORE showing, then show on the
main thread. If `userId` or `customData` are provided, configure server-side verification options on the ad before showing.
presented → trigger `*-opened` (+ `*-impression`, `*-clicked` as
the SDK reports). reward (rewarded only) → the SDK reward callback triggers
`admob://rewarded-earned` `{ adUnitId?, amount, type }` — never synthesized
from dismissal. dismissed → trigger `*-closed` and resolve. failed to present →
trigger `*-failed` with `stage: "show"`, reject `{ code: "SHOW_FAILED", message }`.

### `destroyInterstitial` / `destroyRewarded`
Clear stored ads and listeners, resolve.

### `showBanner`
Args: `{ adUnitId: string, position: "top" | "bottom", size: "banner" | "largeBanner" | "mediumRectangle" | "fullBanner" | "leaderboard" | "adaptive" }`

1. Create the native banner view for `size` on the main thread
   (`adaptive` → anchored adaptive banner for the current width/orientation).
2. Insert it into the activity/view hierarchy so the WebView and the banner
   coexist: bottom or top of the window content, respecting safe areas —
   Android: navigation-bar insets via an `OnApplyWindowInsetsListener`;
   iOS: constraints against `safeAreaLayoutGuide` of the Tauri root view.
3. Load. Success → attach/reveal, trigger `admob://banner-loaded`
   `{ adUnitId }`, resolve. Failure → trigger `admob://banner-failed`
   `{ adUnitId, code, message }`, reject `{ code: "LOAD_FAILED", message }`
   and do not attach anything.
4. Lifecycle events `banner-opened/clicked/impression/closed` are triggered
   from the SDK callbacks.

### `hideBanner`
Hide the banner (keep the view for re-show), resolve.

### `setBannerPosition`
Args: `{ position: "top" | "bottom" }`. Reposition live banner, resolve
(no-op when there is no banner).

### `destroyBanner`
Remove the view from the hierarchy, destroy it, clear references, resolve.

### `destroy`
Tear down banner + interstitial + rewarded (views, listeners, references),
resolve. Must be safe when nothing was initialized.

## Threading rules (ABSOLUTE)

- Every SDK / UI operation runs on the main thread:
  Android `activity.runOnUiThread { }`, iOS `DispatchQueue.main.async { }`.
- `resolve`/`reject`/`trigger` must happen exactly once per command.

## Lifecycle

- Android: override the `Plugin` hooks `onResume`, `onPause`, `onDestroy`.
  `onDestroy` releases the banner and full-screen ads to avoid leaks.
- iOS: releasing on `destroy` must always work; keep weak references to views
  and view controllers to avoid retain cycles.

## Configuration owned by the consuming app (never the plugin)

- Android manifest: `com.google.android.gms.ads.APPLICATION_ID` meta-data.
- iOS Info.plist: `GADApplicationIdentifier` and `NSUserTrackingUsageDescription`.
