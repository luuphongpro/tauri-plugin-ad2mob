//! Public data models shared by the Rust core, the TypeScript bindings and the
//! native (Kotlin/Swift) implementations.
//!
//! Every type that crosses the WebView boundary uses `camelCase` field names so
//! the JSON representation is idiomatic on the JavaScript side.

use serde::{Deserialize, Serialize};

/// Supported runtime platforms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Android,
    Ios,
    Windows,
    Macos,
    Linux,
}

impl Platform {
    /// The platform this crate is currently running on.
    pub fn current() -> Self {
        match std::env::consts::OS {
            "android" => Platform::Android,
            "ios" => Platform::Ios,
            "macos" => Platform::Macos,
            "windows" => Platform::Windows,
            _ => Platform::Linux,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Android => "android",
            Platform::Ios => "ios",
            Platform::Windows => "windows",
            Platform::Macos => "macos",
            Platform::Linux => "linux",
        }
    }

    /// `true` when Google Mobile Ads can actually run on this platform.
    pub fn supports_ads(self) -> bool {
        matches!(self, Platform::Android | Platform::Ios)
    }
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Ad formats supported by the plugin.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AdFormat {
    Banner,
    Interstitial,
    Rewarded,
}

/// Top-level plugin configuration.
///
/// The same shape is used for:
/// - the `plugins > ad2mob` section of `tauri.conf.json` (optional),
/// - the options object of `AdMob.initialize()`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdMobConfig {
    /// Generic AdMob App ID (e.g. `ca-app-pub-3940256099942544~3347511713`).
    /// Used for the current platform when the per-platform ID is not set.
    pub app_id: Option<String>,
    /// AdMob App ID used when running on Android. Takes precedence over `app_id`.
    pub android_app_id: Option<String>,
    /// AdMob App ID used when running on iOS. Takes precedence over `app_id`.
    pub ios_app_id: Option<String>,
    /// Development mode: when `true` the plugin resolves missing Ad Unit IDs to
    /// the official Google test IDs so development builds never serve real ads.
    pub is_testing: bool,
    /// Run `initialize` automatically during plugin setup using the
    /// `tauri.conf.json` configuration. Defaults to `false`.
    pub initialize_on_startup: bool,
    /// iOS only: request App Tracking Transparency authorization right after
    /// initialization. Never requested automatically unless this is `true`.
    pub request_tracking_authorization: bool,
    /// Run the Google UMP consent flow (consent info update + form when
    /// required) automatically during initialization. Defaults to `true`.
    pub automatically_request_consent: bool,
    /// Enables verbose plugin logging. No personal data is ever logged.
    pub debug: bool,
}

impl AdMobConfig {
    /// Returns the app ID that applies to `platform`, considering the
    /// per-platform overrides and the generic `app_id` shorthand.
    pub fn app_id_for(&self, platform: Platform) -> Option<&str> {
        let per_platform = match platform {
            Platform::Android => self.android_app_id.as_deref(),
            Platform::Ios => self.ios_app_id.as_deref(),
            _ => None,
        };
        per_platform.or(self.app_id.as_deref())
    }

    /// Resolves the effective app ID for the current platform, falling back to
    /// Google's official test app ID while `is_testing` is enabled.
    pub fn effective_app_id(&self, platform: Platform) -> Option<String> {
        self.app_id_for(platform).map(str::to_string).or_else(|| {
            if self.is_testing {
                Some(crate::state::test_ids::app_id(platform).to_string())
            } else {
                None
            }
        })
    }

    /// Validates the configuration and returns the effective app ID for the
    /// current platform (mobile only; desktop never requires one).
    pub fn validate(&self, platform: Platform) -> crate::Result<String> {
        match self.effective_app_id(platform) {
            Some(app_id) => {
                crate::state::validate_app_id(&app_id)?;
                Ok(app_id)
            }
            None => Err(crate::Error::InvalidConfiguration(
                "an AdMob App ID is required: set `appId` or the per-platform \
                 `androidAppId`/`iosAppId` in `AdMob.initialize()` (or in the \
                 `plugins > ad2mob` section of tauri.conf.json)"
                    .to_string(),
            )),
        }
    }
}

/// Ad Unit IDs configured at application level through `AdMob.configure()`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdUnitIds {
    pub banner: Option<String>,
    pub interstitial: Option<String>,
    pub rewarded: Option<String>,
}

impl AdUnitIds {
    /// Returns the configured ID for `format` if any.
    pub fn get(&self, format: AdFormat) -> Option<&str> {
        match format {
            AdFormat::Banner => self.banner.as_deref(),
            AdFormat::Interstitial => self.interstitial.as_deref(),
            AdFormat::Rewarded => self.rewarded.as_deref(),
        }
    }

    /// Merges `other` over `self`, keeping existing values when `other` has none.
    pub fn merge(&mut self, other: AdUnitIds) {
        if other.banner.is_some() {
            self.banner = other.banner;
        }
        if other.interstitial.is_some() {
            self.interstitial = other.interstitial;
        }
        if other.rewarded.is_some() {
            self.rewarded = other.rewarded;
        }
    }
}

/// Payload of `configure`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureOptions {
    #[serde(default)]
    pub ad_unit_ids: AdUnitIds,
}

/// Payload of `loadInterstitial` / `loadRewarded`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAdOptions {
    /// Optional Ad Unit ID. When omitted the configured ID (or the official
    /// Google test ID in test mode) is used.
    pub ad_unit_id: Option<String>,
}

/// Position of the native banner relative to the WebView.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BannerPosition {
    Top,
    #[default]
    Bottom,
}

/// Native banner sizes. Values are mapped to the platform SDK sizes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BannerSize {
    /// 320x50 (standard banner).
    Banner,
    /// 320x100 (large banner).
    LargeBanner,
    /// 300x250 (medium rectangle).
    MediumRectangle,
    /// 468x60 (full banner).
    FullBanner,
    /// 728x90 (leaderboard, tablets only).
    Leaderboard,
    /// Anchored adaptive banner sized from the screen width. Recommended.
    #[default]
    Adaptive,
}

/// Payload of `showRewarded`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShowRewardedOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_data: Option<String>,
}

/// Payload of `showBanner`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowBannerOptions {
    pub ad_unit_id: Option<String>,
    pub position: Option<BannerPosition>,
    pub size: Option<BannerSize>,
}

/// Payload of `setBannerPosition`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetBannerPositionOptions {
    pub position: BannerPosition,
}

/// Normalized Google UMP consent status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConsentStatus {
    #[default]
    Unknown,
    Required,
    NotRequired,
    Obtained,
}

/// Normalized iOS App Tracking Transparency status. On platforms without ATT
/// the value is always `notAvailable`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TrackingAuthorizationStatus {
    NotDetermined,
    Restricted,
    Denied,
    Authorized,
    #[default]
    NotAvailable,
}

/// Result of `initialize`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializationResult {
    pub initialized: bool,
    pub platform: Platform,
    pub testing: bool,
}

/// Result of `requestConsent`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentResult {
    pub status: ConsentStatus,
}

/// Result of `requestTrackingAuthorization` and
/// `getTrackingAuthorizationStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingAuthorizationResult {
    pub status: TrackingAuthorizationStatus,
}

/// Snapshot of the plugin state returned by `getStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdMobStatus {
    pub initialized: bool,
    pub platform: Platform,
    pub testing: bool,
    pub consent_status: ConsentStatus,
    pub tracking_status: TrackingAuthorizationStatus,
    pub interstitial_ready: bool,
    pub rewarded_ready: bool,
    pub banner_visible: bool,
}

/// A reward granted by the ad SDK callback of a rewarded ad.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reward {
    pub amount: f64,
    #[serde(rename = "type")]
    pub kind: String,
}

// ---------------------------------------------------------------------------
// Events (Rust -> WebView). On mobile these are triggered by the native layer;
// on desktop the Rust core emits them through the global event system. Both
// paths use identical names and payload shapes.
// ---------------------------------------------------------------------------

/// Namespaced event names emitted by the plugin.
pub mod events {
    pub const INITIALIZED: &str = "admob://initialized";
    pub const CONSENT_CHANGED: &str = "admob://consent-changed";
    pub const TRACKING_AUTHORIZATION_CHANGED: &str = "admob://tracking-authorization-changed";

    pub const BANNER_LOADED: &str = "admob://banner-loaded";
    pub const BANNER_FAILED: &str = "admob://banner-failed";
    pub const BANNER_OPENED: &str = "admob://banner-opened";
    pub const BANNER_CLICKED: &str = "admob://banner-clicked";
    pub const BANNER_IMPRESSION: &str = "admob://banner-impression";
    pub const BANNER_CLOSED: &str = "admob://banner-closed";

    pub const INTERSTITIAL_LOADED: &str = "admob://interstitial-loaded";
    pub const INTERSTITIAL_FAILED: &str = "admob://interstitial-failed";
    pub const INTERSTITIAL_OPENED: &str = "admob://interstitial-opened";
    pub const INTERSTITIAL_IMPRESSION: &str = "admob://interstitial-impression";
    pub const INTERSTITIAL_CLICKED: &str = "admob://interstitial-clicked";
    pub const INTERSTITIAL_CLOSED: &str = "admob://interstitial-closed";

    pub const REWARDED_LOADED: &str = "admob://rewarded-loaded";
    pub const REWARDED_FAILED: &str = "admob://rewarded-failed";
    pub const REWARDED_OPENED: &str = "admob://rewarded-opened";
    pub const REWARDED_IMPRESSION: &str = "admob://rewarded-impression";
    pub const REWARDED_CLICKED: &str = "admob://rewarded-clicked";
    pub const REWARDED_EARNED: &str = "admob://rewarded-earned";
    pub const REWARDED_CLOSED: &str = "admob://rewarded-closed";
}

/// Stage of a failed ad operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AdFailureStage {
    Load,
    Show,
}

/// Payload of `admob://initialized`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializedEvent {
    pub platform: Platform,
    pub testing: bool,
}

/// Payload of `admob://consent-changed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentChangedEvent {
    pub status: ConsentStatus,
}

/// Payload of `admob://tracking-authorization-changed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackingAuthorizationChangedEvent {
    pub status: TrackingAuthorizationStatus,
}

/// Payload of `admob://banner-loaded`, `admob://interstitial-loaded` and
/// `admob://rewarded-loaded`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdLoadedEvent {
    pub ad_unit_id: String,
}

/// Payload of the `*-failed` events.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AdErrorEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ad_unit_id: Option<String>,
    /// Platform SDK error code, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub message: String,
    /// Platform SDK error domain, when available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    /// Distinguishes load failures from show failures. Banner failures are
    /// always load failures and omit this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<AdFailureStage>,
}

/// Payload of lifecycle events such as `admob://interstitial-opened` and
/// `admob://rewarded-closed`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ad_unit_id: Option<String>,
}

/// Payload of `admob://rewarded-earned`. Emitted from the real SDK reward
/// callback, never from the ad dismissal handler.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewardEarnedEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ad_unit_id: Option<String>,
    #[serde(flatten)]
    pub reward: Reward,
}

// ---------------------------------------------------------------------------
// Payloads sent from Rust to the native layer. Field names must match the
// `@InvokeArg` classes (Kotlin) and `Decodable` structs (Swift).
// ---------------------------------------------------------------------------

/// Payload of the native `initialize` call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInitializePayload {
    pub app_id: String,
    pub is_testing: bool,
    pub automatically_request_consent: bool,
    pub request_tracking_authorization: bool,
    pub debug: bool,
}

/// Result resolved by the native `initialize` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeInitializeResult {
    pub consent_status: ConsentStatus,
    pub tracking_status: TrackingAuthorizationStatus,
}

/// Payload of the native `loadInterstitial` / `loadRewarded` calls.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLoadAdPayload {
    pub ad_unit_id: String,
}

/// Payload of the native `showRewarded` call.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeShowRewardedPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_data: Option<String>,
}

/// Payload of the native `showBanner` call.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeShowBannerPayload {
    pub ad_unit_id: String,
    pub position: BannerPosition,
    pub size: BannerSize,
}

/// Payload of the native `setBannerPosition` call.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSetBannerPositionPayload {
    pub position: BannerPosition,
}

/// Result resolved by the native consent calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeConsentResult {
    pub status: ConsentStatus,
}

/// Result resolved by the native tracking calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTrackingResult {
    pub status: TrackingAuthorizationStatus,
}
