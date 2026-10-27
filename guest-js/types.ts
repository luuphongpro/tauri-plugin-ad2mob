/**
 * Public types of `tauri-plugin-ad2mob`.
 *
 * Every type mirrors the Rust models in `src/models.rs` one-to-one. Fields and
 * string unions are stable: they are part of the plugin's public API.
 */

/** Runtime platforms reported by the plugin. */
export type AdMobPlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux'

/** Top-level configuration. Same shape as the `plugins > ad2mob` section of `tauri.conf.json`. */
export interface AdMobConfig {
  /**
   * Generic AdMob App ID (e.g. `ca-app-pub-3940256099942544~3347511713`).
   * Used for the current platform when the per-platform ID is not set.
   */
  appId?: string
  /** AdMob App ID used on Android. Takes precedence over `appId`. */
  androidAppId?: string
  /** AdMob App ID used on iOS. Takes precedence over `appId`. */
  iosAppId?: string
  /**
   * Development mode. When `true`, missing Ad Unit IDs are resolved to the
   * official Google test IDs so development builds never serve real ads.
   */
  isTesting?: boolean
  /** Initialize automatically during plugin setup from `tauri.conf.json`. Defaults to `false`. */
  initializeOnStartup?: boolean
  /** iOS only: request ATT authorization right after initialization. Defaults to `false`. */
  requestTrackingAuthorization?: boolean
  /** Run the Google UMP consent flow automatically during initialization. Defaults to `true`. */
  automaticallyRequestConsent?: boolean
  /** Enables verbose plugin logging. No personal data is ever logged. Defaults to `false`. */
  debug?: boolean
}

/** Application-level Ad Unit IDs set through `AdMob.configure()`. */
export interface AdUnitIds {
  banner?: string
  interstitial?: string
  rewarded?: string
}

/** Options of `AdMob.configure()`. */
export interface ConfigureOptions {
  adUnitIds: AdUnitIds
}

/** Options of `AdMob.loadInterstitial()` / `AdMob.loadRewarded()`. */
export interface LoadAdOptions {
  /**
   * Optional Ad Unit ID. When omitted the configured ID (or the official
   * Google test ID in test mode) is used.
   */
  adUnitId?: string
}

/** Options of `AdMob.showRewarded()`. */
export interface ShowRewardedOptions {
  /**
   * Optional user identifier for server-side verification (SSV).
   * Passed to AdMob SDK to populate the `user_id` query parameter in SSV callbacks.
   */
  userId?: string
  /**
   * Optional custom data string for server-side verification (SSV).
   * Passed to AdMob SDK to populate the `custom_data` query parameter in SSV callbacks.
   */
  customData?: string
}

/** Position of the native banner relative to the WebView. */
export type BannerPosition = 'top' | 'bottom'

/** Native banner sizes, mapped to the platform SDK sizes internally. */
export type BannerSize =
  | 'banner'
  | 'largeBanner'
  | 'mediumRectangle'
  | 'fullBanner'
  | 'leaderboard'
  | 'adaptive'

/** Options of `AdMob.showBanner()`. */
export interface ShowBannerOptions {
  adUnitId?: string
  position?: BannerPosition
  size?: BannerSize
}

/** Options of `AdMob.setBannerPosition()`. */
export interface SetBannerPositionOptions {
  position: BannerPosition
}

/** Normalized Google UMP consent status. */
export type ConsentStatus = 'unknown' | 'required' | 'notRequired' | 'obtained'

/** Normalized iOS App Tracking Transparency status. */
export type TrackingAuthorizationStatus =
  | 'notDetermined'
  | 'restricted'
  | 'denied'
  | 'authorized'
  | 'notAvailable'

/** Result of `AdMob.initialize()`. */
export interface InitializationResult {
  initialized: boolean
  platform: AdMobPlatform
  testing: boolean
}

/** Result of `AdMob.requestConsent()`. */
export interface ConsentResult {
  status: ConsentStatus
}

/** Result of `AdMob.requestTrackingAuthorization()` and `getTrackingAuthorizationStatus()`. */
export interface TrackingAuthorizationResult {
  status: TrackingAuthorizationStatus
}

/** Snapshot of the plugin state returned by `AdMob.getStatus()`. */
export interface AdMobStatus {
  initialized: boolean
  platform: AdMobPlatform
  testing: boolean
  consentStatus: ConsentStatus
  trackingStatus: TrackingAuthorizationStatus
  interstitialReady: boolean
  rewardedReady: boolean
  bannerVisible: boolean
}

/** A reward granted by the ad SDK callback of a rewarded ad. */
export interface Reward {
  amount: number
  type: string
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Payload of `admob://initialized`. */
export interface InitializedEvent {
  platform: AdMobPlatform
  testing: boolean
}

/** Payload of `admob://consent-changed`. */
export interface ConsentChangedEvent {
  status: ConsentStatus
}

/** Payload of `admob://tracking-authorization-changed`. */
export interface TrackingAuthorizationChangedEvent {
  status: TrackingAuthorizationStatus
}

/** Payload of the `*-loaded` events. */
export interface AdLoadedEvent {
  adUnitId: string
}

/** Payload of the `*-failed` events. */
export interface AdErrorEvent {
  adUnitId?: string
  /** Platform SDK error code, when available. */
  code?: string
  message: string
  /** Platform SDK error domain, when available. */
  domain?: string
  /** Distinguishes load failures from show failures. Banner failures omit it. */
  stage?: 'load' | 'show'
}

/** Payload of lifecycle events such as `admob://interstitial-opened`. */
export interface AdEvent {
  adUnitId?: string
}

/** Payload of `admob://rewarded-earned`. Emitted from the real SDK reward callback. */
export interface RewardEarnedEvent {
  adUnitId?: string
  amount: number
  type: string
}

/** Every event emitted by the plugin. Names are stable and namespaced. */
export type AdMobEventName =
  | 'admob://initialized'
  | 'admob://consent-changed'
  | 'admob://tracking-authorization-changed'
  | 'admob://banner-loaded'
  | 'admob://banner-failed'
  | 'admob://banner-opened'
  | 'admob://banner-clicked'
  | 'admob://banner-impression'
  | 'admob://banner-closed'
  | 'admob://interstitial-loaded'
  | 'admob://interstitial-failed'
  | 'admob://interstitial-opened'
  | 'admob://interstitial-impression'
  | 'admob://interstitial-clicked'
  | 'admob://interstitial-closed'
  | 'admob://rewarded-loaded'
  | 'admob://rewarded-failed'
  | 'admob://rewarded-opened'
  | 'admob://rewarded-impression'
  | 'admob://rewarded-clicked'
  | 'admob://rewarded-earned'
  | 'admob://rewarded-closed'

/** Typed event map used by `AdMob.on()`. */
export interface AdMobEventMap {
  'admob://initialized': InitializedEvent
  'admob://consent-changed': ConsentChangedEvent
  'admob://tracking-authorization-changed': TrackingAuthorizationChangedEvent
  'admob://banner-loaded': AdLoadedEvent
  'admob://banner-failed': AdErrorEvent
  'admob://banner-opened': AdEvent
  'admob://banner-clicked': AdEvent
  'admob://banner-impression': AdEvent
  'admob://banner-closed': AdEvent
  'admob://interstitial-loaded': AdLoadedEvent
  'admob://interstitial-failed': AdErrorEvent
  'admob://interstitial-opened': AdEvent
  'admob://interstitial-impression': AdEvent
  'admob://interstitial-clicked': AdEvent
  'admob://interstitial-closed': AdEvent
  'admob://rewarded-loaded': AdLoadedEvent
  'admob://rewarded-failed': AdErrorEvent
  'admob://rewarded-opened': AdEvent
  'admob://rewarded-impression': AdEvent
  'admob://rewarded-clicked': AdEvent
  'admob://rewarded-earned': RewardEarnedEvent
  'admob://rewarded-closed': AdEvent
}
