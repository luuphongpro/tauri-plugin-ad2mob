# tauri-plugin-ad2mob

[![CI](https://github.com/marrionesa/tauri-plugin-ad2mob/actions/workflows/ci.yml/badge.svg)](https://github.com/marrionesa/tauri-plugin-ad2mob/actions/workflows/ci.yml)
[![Crates.io](https://img.shields.io/crates/v/tauri-plugin-ad2mob.svg)](https://crates.io/crates/tauri-plugin-ad2mob)
[![docs.rs](https://img.shields.io/docsrs/tauri-plugin-ad2mob)](https://docs.rs/tauri-plugin-ad2mob)
[![npm](https://img.shields.io/npm/v/tauri-plugin-ad2mob.svg)](https://www.npmjs.com/package/tauri-plugin-ad2mob)
[![License](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](https://github.com/marrionesa/tauri-plugin-ad2mob#license)

Google AdMob (Mobile Ads) for **Tauri v2** apps on **Android** and **iOS**:
banners (native views, never inside the WebView DOM), interstitials, rewarded
ads, Google UMP consent and iOS App Tracking Transparency — behind one
strongly typed TypeScript API.

> **Independent community project**, created and maintained by
> [**marrionesa**](https://github.com/marrionesa). Not affiliated with, endorsed by or
> sponsored by Google LLC or the Tauri Programme within The Commons
> Conservancy. Google AdMob, Google Mobile Ads and Google UMP are products of
> Google LLC and are subject to Google's own terms and policies.

```ts
import { AdMob } from "tauri-plugin-ad2mob";

await AdMob.initialize({ isTesting: true });

await AdMob.requestConsent();
await AdMob.requestTrackingAuthorization(); // iOS only

await AdMob.showBanner({ position: "bottom", size: "adaptive" });

await AdMob.loadInterstitial();
if (await AdMob.isInterstitialReady()) {
  await AdMob.showInterstitial();
}

await AdMob.loadRewarded();
const unlisten = await AdMob.on("admob://rewarded-earned", ({ payload }) => {
  console.log(`Reward: ${payload.amount} ${payload.type}`);
});
if (await AdMob.isRewardedReady()) {
  await AdMob.showRewarded();
}
```

## Features

- **Initialization** — idempotent `initialize()` with generic and per-platform
  App IDs, development mode (`isTesting`) that automatically resolves to the
  official Google test IDs, and optional startup initialization from
  `tauri.conf.json`.
- **Privacy first** — Google UMP consent flow (`requestConsent`,
  `getConsentStatus`) with a normalized `ConsentStatus`
  (`unknown / required / notRequired / obtained`), and iOS ATT
  (`requestTrackingAuthorization`) with a normalized
  `TrackingAuthorizationStatus`. Ad requests are rejected with
  `CONSENT_REQUIRED` while the UMP state is `required`.
- **Interstitial & rewarded** — explicit load → ready → show → closed state
  machines, real SDK reward callbacks (`admob://rewarded-earned` is only
  emitted from `OnUserEarnedRewardListener` / `GADRewardedAdDelegate`, never
  synthesized from dismissal), `is*Ready()` queries and explicit destroy.
- **Native banners** — platform-native `AdView` / `GADBannerView` overlaid on
  the requested edge of the WebView (top/bottom), safe-area aware (status bar,
  navigation bar, home indicator, edge-to-edge), six sizes including anchored
  adaptive banners, plus hide / reposition / destroy.
- **Typed events** — every SDK callback is forwarded as a namespaced event
  (`admob://banner-loaded`, `admob://interstitial-failed`,
  `admob://rewarded-earned`, …) with structured payloads.
- **Desktop safe** — the crate compiles for Windows/macOS/Linux; every mobile
  operation returns a controlled `UNSUPPORTED_PLATFORM` error instead of
  breaking the build or crashing, `isSupported()` reports `false`.
- **Concurrency safe** — all state transitions go through a `Mutex`-guarded
  state machine; concurrent `loadInterstitial()` calls never corrupt state.

## Install

```
npm add tauri-plugin-ad2mob          # or: pnpm / bun / yarn
cargo add tauri-plugin-ad2mob
```

## Setup

### 1. Register the Rust plugin

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_ad2mob::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Optional inline configuration (equivalent to the `plugins > ad2mob` section of
`tauri.conf.json`):

```rust
.plugin(tauri_plugin_ad2mob::init_with_config(serde_json::json!({
    "isTesting": true,
    "initializeOnStartup": true,
})))
```

### 2. Grant the capability

Add the default permission to your capability file (e.g.
`src-tauri/capabilities/default.json`):

```json
{
  "permissions": [
    "ad2mob:default"
  ]
}
```

`ad2mob:default` allows every command, including the plugin event listeners
used by `AdMob.on()`. Ads are not a security-sensitive surface (the plugin
never exposes filesystem, network or device capabilities to the webview), so
a single entry keeps the setup simple.

### 3. Android configuration

The AdMob **App ID is app-owned**; the plugin validates it at runtime and
fails with a descriptive `INVALID_CONFIGURATION` error when missing.

Add to `gen/android/app/src/main/AndroidManifest.xml` inside `<application>`
(create the file through `tauri android init`):

```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY" />
```

> While developing, use Google's test App ID
> `ca-app-pub-3940256099942544~3347511713`.

The Google Mobile Ads SDK and UMP are linked automatically from the plugin's
`android/` Gradle module (`play-services-ads` 24.x, `user-messaging-platform`
3.x); no extra permissions are needed (the SDK's manifest declares
`INTERNET`/`ACCESS_NETWORK_STATE`). If you enable R8 minification, the plugin
ships consumer keep-rules for its own classes — nothing to configure.

### 4. iOS configuration

Add to the generated `Info.plist` (e.g. via `gen/apple` project settings or
Xcode):

```xml
<key>GADApplicationIdentifier</key>
<string>ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY</string>
<key>NSUserTrackingUsageDescription</key>
<string>Your data will be used to show you more relevant ads.</string>
<key>SKAdNetworkItems</key>
<!-- Google's SKAdNetwork IDs, see the AdMob docs for the current list -->
</plist-entry>
```

> While developing, use Google's test App ID
> `ca-app-pub-3940256099942544~1458002511`.

The GoogleMobileAds (13.x) and UMP (3.x) frameworks are resolved through
Swift Package Manager from the plugin's `ios/Package.swift` automatically
when the Tauri CLI generates the Xcode project. ATT usage requires the
`NSUserTrackingUsageDescription` entry above — App Store submission with ads
additionally requires the App Tracking Transparency and advertising
identifiers declarations in your App Privacy answers; the plugin cannot do
that part for you.

## Usage

### Initialize (idempotent)

```ts
// Option A: one App ID for both platforms
await AdMob.initialize({
  appId: "ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY",
  isTesting: true,
});

// Option B: per-platform App IDs
await AdMob.initialize({
  androidAppId: "ca-app-pub-…~…",
  iosAppId: "ca-app-pub-…~…",
  isTesting: false,
  automaticallyRequestConsent: true,   // default
  requestTrackingAuthorization: false, // iOS: prompt ATT right after init
  debug: true,                         // verbose logs in development
});
```

Calling `initialize()` again is a safe no-op that returns the current state —
it never re-runs the native SDK flow. Use `AdMob.configure()` for Ad Unit
IDs.

### Ad Unit IDs

```ts
await AdMob.configure({
  adUnitIds: {
    banner: "ca-app-pub-…/…",
    interstitial: "ca-app-pub-…/…",
    rewarded: "ca-app-pub-…/…",
  },
});

// Per-call overrides are also possible:
await AdMob.loadInterstitial({ adUnitId: "ca-app-pub-…/…" });
```

Resolution order: explicit argument → `configure()` value → official Google
test ID while `isTesting: true` → `INVALID_CONFIGURATION` error.

### Consent (Google UMP)

```ts
const { status } = await AdMob.requestConsent(); // update + form when required
const current = await AdMob.getConsentStatus();  // "unknown" | "required" | "notRequired" | "obtained"
```

With `automaticallyRequestConsent: true` (default) the flow already runs
during `initialize()`. While the status is `required`, ad requests reject with
`CONSENT_REQUIRED` so ads are never requested before consent. There is no
way — and no need — to persist consent yourself: the UMP SDK stores it
per-device.

### App Tracking Transparency (iOS)

```ts
const status = await AdMob.requestTrackingAuthorization();
// "notDetermined" | "restricted" | "denied" | "authorized"
// Android and desktop always report "notAvailable" — the API is safe to call
// unconditionally and never throws there.
```

ATT is **never** requested automatically; set
`requestTrackingAuthorization: true` in `initialize()` or call the method
explicitly from a user gesture.

### Interstitial

```ts
await AdMob.loadInterstitial();          // resolves when loaded
if (await AdMob.isInterstitialReady()) {
  await AdMob.showInterstitial();        // resolves when the user dismisses it
}
await AdMob.destroyInterstitial();
```

`showInterstitial()` rejects with `AD_NOT_READY` when nothing is loaded and
with `LOAD_FAILED`/`SHOW_FAILED` (or a typed `AdMobError`) on SDK failures.

### Rewarded

```ts
const unlisten = await AdMob.on("admob://rewarded-earned", ({ payload }) => {
  // payload: { amount: number, type: string } — from the REAL SDK callback
  grantReward(payload.amount);
});

await AdMob.loadRewarded();
if (await AdMob.isRewardedReady()) {
  // Optional Server-Side Verification (SSV) parameters:
  await AdMob.showRewarded({
    userId: "user-12345",
    customData: "level_5_reward",
  }); // resolves when dismissed
}
// unlisten(); when done
```

Rewards are only reported by the SDK's own reward callback. Dismissing the ad
without earning it emits `admob://rewarded-closed` but never a reward.
When `userId` or `customData` are provided, the plugin configures the AdMob SDK
Server-Side Verification (SSV) options so your backend verification callback receives
the corresponding `user_id` and `custom_data` parameters.

### Native banner

```ts
await AdMob.showBanner({ position: "bottom", size: "adaptive" });
await AdMob.hideBanner();                 // keeps the view for a re-show
await AdMob.showBanner();                 // re-shows / refreshes
await AdMob.setBannerPosition({ position: "top" });
await AdMob.isBannerVisible();            // true while visible
await AdMob.destroyBanner();
```

The banner is a **native view** (`AdView` / `GADBannerView`) attached to the
requested edge of the window content, above the home indicator / navigation
bar (safe areas are respected). It intentionally is **not** a DOM element.

**Layout note (documented limitation):** the banner floats above the WebView
content. Reserve matching space in your UI (for example a bottom padding on
your app shell equal to the banner height) so the ad never covers interactive
controls. The WebView itself is not resized: doing so would fight the Tauri
runtime's layout management on both platforms.

### Events

```ts
const unlisten = await AdMob.on("admob://interstitial-failed", ({ payload }) => {
  console.log(payload.stage, payload.code, payload.message);
});
await unlisten(); // remove the listener
```

All events, with stable names and payload shapes:

| Event | Payload |
| --- | --- |
| `admob://initialized` | `{ platform, testing }` |
| `admob://consent-changed` | `{ status }` |
| `admob://tracking-authorization-changed` | `{ status }` |
| `admob://banner-loaded` | `{ adUnitId }` |
| `admob://banner-failed` | `{ adUnitId?, code?, message, domain? }` |
| `admob://banner-opened` / `-clicked` / `-impression` / `-closed` | `{ adUnitId? }` |
| `admob://interstitial-loaded` / `admob://rewarded-loaded` | `{ adUnitId }` |
| `admob://interstitial-failed` / `admob://rewarded-failed` | `{ adUnitId?, code?, message, domain?, stage: "load" \| "show" }` |
| `admob://interstitial-opened` / `-impression` / `-clicked` / `-closed` | `{ adUnitId? }` |
| `admob://rewarded-opened` / `-impression` / `-clicked` / `-closed` | `{ adUnitId? }` |
| `admob://rewarded-earned` | `{ adUnitId?, amount, type }` |

Delivery: on Android/iOS events travel through the Tauri plugin event channel
(`addPluginListener`); on desktop they are emitted on the global event system
(`listen`). `AdMob.on()` picks the right mechanism automatically.

### Status, detection and cleanup

```ts
await AdMob.isSupported(); // false on Windows/macOS/Linux
await AdMob.getStatus();
// {
//   initialized, platform, testing, consentStatus, trackingStatus,
//   interstitialReady, rewardedReady, bannerVisible
// }
await AdMob.destroy(); // destroys every native ad resource, resets state
```

`destroy()` is the global cleanup: banner, interstitial and rewarded
resources are released, listeners are dropped and the plugin can be
initialized again.

## Error handling

Every method throws an `AdMobError` (an `Error` subclass) with a stable
`code`:

| Code | Meaning |
| --- | --- |
| `NOT_INITIALIZED` | ad operation attempted before `initialize()` |
| `INVALID_CONFIGURATION` | missing/invalid App ID, Ad Unit ID or platform config |
| `INVALID_ARGUMENT` | malformed arguments |
| `AD_NOT_READY` | `show*()` without a loaded ad |
| `LOAD_FAILED` | the SDK failed to load the ad (details in `message`) |
| `SHOW_FAILED` | the SDK failed to present the ad |
| `CONSENT_REQUIRED` | UMP state is `required`; run `requestConsent()` first |
| `UNSUPPORTED_PLATFORM` | mobile-only API used on desktop |
| `NATIVE_ERROR` | anything else reported by the native layer |

```ts
import { AdMob, isAdMobError } from "tauri-plugin-ad2mob";

try {
  await AdMob.showInterstitial();
} catch (error) {
  if (isAdMobError(error) && error.code === "AD_NOT_READY") {
    await AdMob.loadInterstitial();
  }
}
```

## Testing

While `isTesting: true`, missing Ad Unit IDs resolve to **Google's official
test IDs** (documented at
[Android](https://developers.google.com/admob/android/test-ads) and
[iOS](https://developers.google.com/admob/ios/test-ads)):

| Format | Android | iOS |
| --- | --- | --- |
| Banner | `ca-app-pub-3940256099942544/6300978111` | `ca-app-pub-3940256099942544/2934735716` |
| Interstitial | `ca-app-pub-3940256099942544/1033173712` | `ca-app-pub-3940256099942544/441146891` |
| Rewarded | `ca-app-pub-3940256099942544/5224354917` | `ca-app-pub-3940256099942544/1717083536` |

This is for **development and automated testing only**. Clicking your own
production ads violates the AdMob policy and can get the account suspended.

Notes on real testing:

- Android emulators work with the test IDs; real ads require a device with
  Google Play services and a configured test device ID
  (`MobileAds.setRequestConfiguration` / `testDeviceIds`).
- The iOS **simulator** works with the test IDs. Real-device testing is
  required for final validation; UMP consent behavior and ATT prompts can
  differ between simulator and device.
- The bundled example app (`examples/admob-demo`) exercises every feature
  against the test IDs and prints all events on screen.

## Desktop behavior

| API | Desktop |
| --- | --- |
| `initialize()` | no-op success (state tracked, `admob://initialized` emitted) |
| `configure()`, `getStatus()`, `isSupported()`, status queries | work normally |
| `requestTrackingAuthorization()` | resolves `notAvailable` |
| `requestConsent()` and every ad operation | reject `UNSUPPORTED_PLATFORM` |
| `destroy()` | no-op success |

The plugin crate never links the desktop WebView runtime, so adding it does
not change your desktop build dependencies.

## API reference

| Method | Returns |
| --- | --- |
| `AdMob.initialize(options?)` | `InitializationResult` |
| `AdMob.configure({ adUnitIds })` | `void` |
| `AdMob.isSupported()` | `boolean` |
| `AdMob.getStatus()` | `AdMobStatus` |
| `AdMob.requestConsent()` | `{ status }` |
| `AdMob.getConsentStatus()` | `ConsentStatus` |
| `AdMob.requestTrackingAuthorization()` | `TrackingAuthorizationStatus` |
| `AdMob.getTrackingAuthorizationStatus()` | `TrackingAuthorizationStatus` |
| `AdMob.loadInterstitial(options?)` | `void` (resolves when loaded) |
| `AdMob.showInterstitial()` | `void` (resolves when dismissed) |
| `AdMob.isInterstitialReady()` | `boolean` |
| `AdMob.destroyInterstitial()` | `void` |
| `AdMob.loadRewarded(options?)` | `void` (resolves when loaded) |
| `AdMob.showRewarded(options?)` | `void` (resolves when dismissed) |
| `AdMob.isRewardedReady()` | `boolean` |
| `AdMob.destroyRewarded()` | `void` |
| `AdMob.showBanner(options?)` | `void` (resolves when loaded) |
| `AdMob.hideBanner()` | `void` |
| `AdMob.isBannerVisible()` | `boolean` |
| `AdMob.setBannerPosition({ position })` | `void` |
| `AdMob.destroyBanner()` | `void` |
| `AdMob.on(event, handler)` | `Unlisten` (awaitable) |
| `AdMob.destroy()` | `void` |

## Troubleshooting

**Ad not loading / no fill.** Test IDs return occasional no-fill; retry or
switch formats. In production check the AdMob console for the app/ad-unit
status and traffic. Also verify the device can reach `googleads.g.doubleclick.net`.

**`INVALID_CONFIGURATION` on Android.** The `<meta-data
android:name="com.google.android.gms.ads.APPLICATION_ID">` entry is missing
from the app manifest. Add it inside `<application>` (see Setup) and rebuild.

**`INVALID_CONFIGURATION` on iOS.** `GADApplicationIdentifier` is missing
from `Info.plist` — the GoogleMobileAds SDK aborts without it.

**Consent required before ads.** The UMP status is `required`. Call
`AdMob.requestConsent()` (or keep `automaticallyRequestConsent: true`) and
complete the form once; the status is cached per-device by the UMP SDK.

**ATT prompt not appearing (iOS).** ATT must be requested while the app is
active and only prompts once per install (reinstall or reset the simulator
privacy settings to see it again). Check that `NSUserTrackingUsageDescription`
exists in Info.plist.

**Banner covering app UI.** The native banner overlays the requested edge of
the WebView. Reserve padding in your layout (see the banner section) instead
of relying on the plugin to shrink the WebView.

**Banner not visible.** `showBanner()` resolves only after the ad loaded; a
`banner-failed` event means nothing was attached. Also check that
`hideBanner()` was not called earlier and that the safe-area insets are not
consuming the banner (e.g. gesture navigation bars on Android).

**Interstitial/Rewarded `AD_NOT_READY`.** Ads must load before showing and
are consumed after one show — reload after every `*-closed` event. Loads can
take seconds on poor connections; the `load*` promise resolves on completion.

**Reward not received.** The reward only fires from the SDK callback while
the ad is being watched (`admob://rewarded-earned`). Closing the ad early,
SDK no-fill quirks or mediation adapters can legitimately skip it — never
grant rewards from `rewarded-closed`.

**Main Thread violations.** If you extend the native code, keep every
SDK/UI call on the main thread (`runOnUiThread` / `DispatchQueue.main`) —
the shipped managers already do.

**Desktop `UNSUPPORTED_PLATFORM`.** Expected: ads only exist on mobile.
Gate the calls with `AdMob.isSupported()` if you prefer skipping silently.

## Known limitations

- The banner overlays the WebView instead of resizing it (see above).
- A `showBanner` while another banner load is in flight replaces the
  previous banner; the superseded promise rejects with `LOAD_FAILED`.
- iOS full-screen ads keep their pending show promise across `destroy()` so
  the SDK can still report the dismissal — the promise always settles.
- Mediation networks are supported only as far as the base Google Mobile Ads
  SDK supports them (no per-network adapters are configured by this plugin).
- Android/iOS native code is validated by review + unit-tested pure logic in
  this repository; run the example app on real hardware before shipping.

## Versioning

SemVer. `0.x` releases may still refine the API before `1.0.0`; see
[CHANGELOG.md](CHANGELOG.md) for the current status.

## Contributing

Issues and PRs are welcome. Run the full validation suite before submitting:

```
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
bun run build && bun run typecheck && bun run test   # guest bindings
```

## Documentation website

The standalone documentation site lives in [`ad2mob-website`](ad2mob-website)
and deploys automatically to GitHub Pages from the `master` branch through
[`.github/workflows/pages.yml`](.github/workflows/pages.yml). Its expected URL
is <https://marrionesa.github.io/tauri-plugin-ad2mob/>.

To update the repository Homepage field and its short GitHub description
automatically, configure the optional `REPO_SETTINGS_TOKEN` repository secret
with permission to edit repository metadata. The Pages deployment itself only
needs the standard Pages workflow permissions.

## License

Dual-licensed under [MIT](LICENSE-MIT) or
[Apache-2.0](LICENSE-APACHE), at your option. Google Mobile Ads, Google UMP
and related SDKs are Google products distributed under their own terms —
using this plugin does not change your obligations under the [Google AdMob
program policies](https://support.google.com/admob/answer/6128543).
