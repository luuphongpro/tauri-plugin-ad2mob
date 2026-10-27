/**
 * tauri-plugin-ad2mob — Google AdMob (Mobile Ads) for Tauri v2 apps.
 *
 * An independent community plugin bridging Google Mobile Ads, Google UMP
 * (consent) and iOS App Tracking Transparency into a single typed API.
 * Not affiliated with or endorsed by Google.
 *
 * @module
 */

import { invoke } from '@tauri-apps/api/core'
import { toAdMobError } from './errors.js'
import { on, type Unlisten } from './events.js'
import type {
  AdMobConfig,
  AdMobEventMap,
  AdMobEventName,
  AdMobStatus,
  ConfigureOptions,
  ConsentResult,
  ConsentStatus,
  InitializationResult,
  LoadAdOptions,
  SetBannerPositionOptions,
  ShowBannerOptions,
  ShowRewardedOptions,
  TrackingAuthorizationResult,
  TrackingAuthorizationStatus,
} from './types.js'

export type { Unlisten } from './events.js'
export {
  AdMobError,
  isAdMobError,
  toAdMobError,
  type AdMobErrorCode,
} from './errors.js'
export type * from './types.js'

/**
 * Runs a plugin command and converts rejections into `AdMobError`.
 * Kept in one place so every method shares identical error semantics.
 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(`plugin:ad2mob|${command}`, args)
  } catch (error) {
    throw toAdMobError(error)
  }
}

/**
 * Public AdMob API. Every method is safe to call unconditionally:
 *
 * - On desktop, ad operations reject with the `UNSUPPORTED_PLATFORM` code
 *   while `initialize`, `configure`, `getStatus`, `destroy` and the status
 *   queries keep working.
 * - `initialize` is idempotent: calling it again never re-runs the native
 *   initialization.
 */
export const AdMob = {
  /**
   * Initializes the Google Mobile Ads SDK.
   *
   * When `isTesting` is enabled and no Ad Unit IDs are configured, the
   * official Google test IDs are used automatically.
   */
  initialize(options?: AdMobConfig): Promise<InitializationResult> {
    return call<InitializationResult>('initialize', { options: options ?? {} })
  },

  /** Configures application-level Ad Unit IDs (merged over previous values). */
  configure(options: ConfigureOptions): Promise<void> {
    return call<void>('configure', { options })
  },

  /** `true` on Android and iOS, `false` on desktop platforms. */
  isSupported(): Promise<boolean> {
    return call<boolean>('is_supported')
  },

  /** Snapshot of the current plugin state. */
  getStatus(): Promise<AdMobStatus> {
    return call<AdMobStatus>('get_status')
  },

  /** Runs the Google UMP consent flow (update + form when required). */
  requestConsent(): Promise<ConsentResult> {
    return call<ConsentResult>('request_consent')
  },

  /** Returns the last known UMP consent status. */
  getConsentStatus(): Promise<ConsentStatus> {
    return call<ConsentResult>('get_consent_status').then((result) => result.status)
  },

  /** Requests iOS App Tracking Transparency authorization. */
  requestTrackingAuthorization(): Promise<TrackingAuthorizationStatus> {
    return call<TrackingAuthorizationResult>('request_tracking_authorization').then(
      (result) => result.status,
    )
  },

  /** Returns the last known ATT status. */
  getTrackingAuthorizationStatus(): Promise<TrackingAuthorizationStatus> {
    return call<TrackingAuthorizationResult>('get_tracking_authorization_status').then(
      (result) => result.status,
    )
  },

  /** Loads an interstitial. Resolves once the ad is ready to show. */
  loadInterstitial(options?: LoadAdOptions): Promise<void> {
    return call<void>('load_interstitial', { options: options ?? {} })
  },

  /**
   * Shows a previously loaded interstitial. Resolves once the user dismissed
   * the ad. Rejects with `AD_NOT_READY` when nothing is loaded.
   */
  showInterstitial(): Promise<void> {
    return call<void>('show_interstitial')
  },

  /** `true` when an interstitial is loaded and ready to show. */
  isInterstitialReady(): Promise<boolean> {
    return call<boolean>('is_interstitial_ready')
  },

  /** Destroys the loaded interstitial, if any. */
  destroyInterstitial(): Promise<void> {
    return call<void>('destroy_interstitial')
  },

  /** Loads a rewarded ad. Resolves once the ad is ready to show. */
  loadRewarded(options?: LoadAdOptions): Promise<void> {
    return call<void>('load_rewarded', { options: options ?? {} })
  },

  /**
   * Shows a previously loaded rewarded ad. Resolves once the user dismissed
   * the ad; the reward is delivered through the `admob://rewarded-earned`
   * event from the real SDK callback.
   *
   * @param options Optional parameters such as `userId` and `customData` for Server-Side Verification (SSV).
   */
  showRewarded(options?: ShowRewardedOptions): Promise<void> {
    return call<void>('show_rewarded', { options: options ?? {} })
  },

  /** `true` when a rewarded ad is loaded and ready to show. */
  isRewardedReady(): Promise<boolean> {
    return call<boolean>('is_rewarded_ready')
  },

  /** Destroys the loaded rewarded ad, if any. */
  destroyRewarded(): Promise<void> {
    return call<void>('destroy_rewarded')
  },

  /**
   * Loads and shows a native banner (never rendered inside the WebView DOM).
   * Defaults: `position: "bottom"`, `size: "adaptive"`.
   */
  showBanner(options?: ShowBannerOptions): Promise<void> {
    return call<void>('show_banner', { options: options ?? {} })
  },

  /** Hides the banner without destroying it. */
  hideBanner(): Promise<void> {
    return call<void>('hide_banner')
  },

  /** `true` when the native banner is currently visible. */
  isBannerVisible(): Promise<boolean> {
    return call<boolean>('is_banner_visible')
  },

  /** Moves a visible banner to another position. */
  setBannerPosition(options: SetBannerPositionOptions): Promise<void> {
    return call<void>('set_banner_position', { options })
  },

  /** Destroys the native banner and frees its resources. */
  destroyBanner(): Promise<void> {
    return call<void>('destroy_banner')
  },

  /**
   * Subscribes to a plugin event. Returns an awaitable `unlisten` function.
   *
   * ```ts
   * const unlisten = await AdMob.on('admob://rewarded-earned', ({ payload }) => {
   *   const reward: Reward = payload
   *   console.log(`+${payload.amount} ${payload.type}`)
   * })
   * ```
   */
  on<E extends AdMobEventName>(
    event: E,
    handler: (payload: AdMobEventMap[E]) => void,
  ): Promise<Unlisten> {
    return on(event, handler)
  },

  /**
   * Destroys every native ad resource (banner, interstitial, rewarded) and
   * resets the plugin state so it can be initialized again.
   */
  destroy(): Promise<void> {
    return call<void>('destroy')
  },
}

export default AdMob
export type {
  AdMobConfig,
  AdMobEventMap,
  AdMobEventName,
  AdMobPlatform,
  AdMobStatus,
  AdUnitIds,
  BannerPosition,
  BannerSize,
  ConfigureOptions,
  ConsentResult,
  ConsentStatus,
  InitializationResult,
  InitializedEvent,
  LoadAdOptions,
  Reward,
  SetBannerPositionOptions,
  ShowBannerOptions,
  TrackingAuthorizationResult,
  TrackingAuthorizationStatus,
} from './types.js'
