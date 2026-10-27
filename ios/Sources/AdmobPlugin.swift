// Copyright 2026 tauri-plugin-ad2mob contributors
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import Foundation
import GoogleMobileAds
import Tauri
import UIKit
import WebKit

// Argument payloads. Fields are optional so that malformed or partial
// payloads are reported as stable `INVALID_ARGUMENT` rejections instead of
// opaque `Decodable` failures escaping to the IPC layer.

/// `initialize` arguments (contract: `{ appId, isTesting, automaticallyRequestConsent, requestTrackingAuthorization, debug }`).
struct InitializeArgs: Decodable {
  let appId: String?
  let isTesting: Bool?
  let automaticallyRequestConsent: Bool?
  let requestTrackingAuthorization: Bool?
  let debug: Bool?
}

/// `loadInterstitial` / `loadRewarded` arguments (`{ adUnitId }`).
struct LoadAdArgs: Decodable {
  let adUnitId: String?
}

/// `showRewarded` arguments (`{ userId, customData }`).
struct ShowRewardedArgs: Decodable {
  let userId: String?
  let customData: String?
}

/// `showBanner` arguments (`{ adUnitId, position, size }`).
struct ShowBannerArgs: Decodable {
  let adUnitId: String?
  let position: String?
  let size: String?
}

/// `setBannerPosition` arguments (`{ position }`).
struct SetBannerPositionArgs: Decodable {
  let position: String?
}

/// Native entry point of the AdMob plugin. The Rust core registers it through
/// `register_ios_plugin(init_plugin_admob)` (see the `@_cdecl` export below).
///
/// The Tauri plugin manager dispatches commands on its background IPC queue
/// (`PluginManager.ipcDispatchQueue`), so EVERY command hops to the main
/// queue before touching the Google Mobile Ads SDK, UIKit or plugin state
/// (contract threading rules). Rejections only ever carry `{ code, message }`
/// and resolve/reject happen exactly once per invoke.
class AdmobPlugin: Plugin {
  /// Info.plist key holding the AdMob App ID (contract: app-owned configuration).
  private static let appIdentifierKey = "GADApplicationIdentifier"

  private let consentManager = ConsentManager()
  private let trackingManager = TrackingManager()
  private lazy var bannerManager = BannerManager(plugin: self)
  private lazy var interstitialManager = InterstitialManager(plugin: self)
  private lazy var rewardedManager = RewardedManager(plugin: self)

  /// Weak on purpose: the managers are owned by the plugin and must never
  /// keep it (or the WebView) alive.
  private weak var webView: WKWebView?

  // Main-queue-confined state: every command hops to the main queue before
  // reading or writing any of these.
  private var initialized = false
  private var initializationInFlight = false
  private var testing = false
  private var debugEnabled = false

  /// Called by the Tauri plugin manager when the WebView is created; captures
  /// the WebView as a fallback anchor for the banner container view.
  public override func load(webview: WKWebView) {
    self.webView = webview
  }

  // MARK: - Commands

  /// Starts the Mobile Ads SDK and (optionally) the consent and ATT flows.
  /// Resolves `{ consentStatus, trackingStatus }` with normalized values.
  @objc public func initialize(_ invoke: Invoke) throws {
    guard let args = decodeArgs(InitializeArgs.self, command: "initialize", invoke: invoke) else {
      return
    }
    guard let appId = args.appId, !appId.isEmpty else {
      invoke.reject("initialize requires a non-empty `appId`", code: "INVALID_ARGUMENT")
      return
    }

    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      self.runInitialize(appId: appId, args: args, invoke: invoke)
    }
  }

  /// Runs the UMP consent flow on demand.
  /// Resolves `{ status }` with the normalized consent status.
  @objc public func requestConsent(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      guard let viewController = self.rootViewController() else {
        invoke.reject(
          "no root view controller available to present the consent form", code: "NATIVE_ERROR")
        return
      }
      self.consentManager.requestConsent(from: viewController) { result in
        // ConsentManager hops to the main queue before calling back.
        switch result {
        case .success(let status):
          self.trigger(AdmobEvents.CONSENT_CHANGED, data: ["status": status])
          invoke.resolve(["status": status])
        case .failure(let flowError):
          invoke.reject(flowError.message, code: "NATIVE_ERROR")
        }
      }
    }
  }

  /// Runs the ATT prompt on demand.
  /// Resolves `{ status }` with the normalized authorization status
  /// (`"notAvailable"` below iOS 14).
  @objc public func requestTrackingAuthorization(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      // ATT prompts are only shown while the app is active: requesting from
      // the main queue (we are on it here) satisfies that requirement.
      self.trackingManager.requestAuthorization { status in
        // TrackingManager hops to the main queue before calling back.
        self.trigger(AdmobEvents.TRACKING_AUTHORIZATION_CHANGED, data: ["status": status])
        invoke.resolve(["status": status])
      }
    }
  }

  /// Loads a fresh interstitial. Resolves once the SDK reports the ad ready.
  @objc public func loadInterstitial(_ invoke: Invoke) throws {
    guard let args = decodeArgs(LoadAdArgs.self, command: "loadInterstitial", invoke: invoke)
    else {
      return
    }
    guard let adUnitId = args.adUnitId, !adUnitId.isEmpty else {
      invoke.reject("loadInterstitial requires a non-empty `adUnitId`", code: "INVALID_ARGUMENT")
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      guard self.initialized else {
        invoke.reject("the plugin is not initialized; call initialize first", code: "NOT_INITIALIZED")
        return
      }
      self.interstitialManager.load(adUnitId: adUnitId, invoke: invoke)
    }
  }

  /// Presents the stored interstitial; resolves when the user dismisses it.
  @objc public func showInterstitial(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      guard self.initialized else {
        invoke.reject("the plugin is not initialized; call initialize first", code: "NOT_INITIALIZED")
        return
      }
      self.interstitialManager.show(invoke: invoke)
    }
  }

  /// Clears the stored interstitial. Safe when nothing was loaded.
  @objc public func destroyInterstitial(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      self?.interstitialManager.destroy()
      invoke.resolve()
    }
  }

  /// Loads a fresh rewarded ad. Resolves once the SDK reports the ad ready.
  @objc public func loadRewarded(_ invoke: Invoke) throws {
    guard let args = decodeArgs(LoadAdArgs.self, command: "loadRewarded", invoke: invoke) else {
      return
    }
    guard let adUnitId = args.adUnitId, !adUnitId.isEmpty else {
      invoke.reject("loadRewarded requires a non-empty `adUnitId`", code: "INVALID_ARGUMENT")
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      guard self.initialized else {
        invoke.reject("the plugin is not initialized; call initialize first", code: "NOT_INITIALIZED")
        return
      }
      self.rewardedManager.load(adUnitId: adUnitId, invoke: invoke)
    }
  }

  /// Presents the stored rewarded ad; resolves when the user dismisses it.
  /// Rewards arrive through the `admob://rewarded-earned` event only.
  @objc public func showRewarded(_ invoke: Invoke) throws {
    guard let args = decodeArgs(ShowRewardedArgs.self, command: "showRewarded", invoke: invoke) else {
      return
    }
    let userId = args.userId
    let customData = args.customData

    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      guard self.initialized else {
        invoke.reject("the plugin is not initialized; call initialize first", code: "NOT_INITIALIZED")
        return
      }
      self.rewardedManager.show(userId: userId, customData: customData, invoke: invoke)
    }
  }

  /// Clears the stored rewarded ad. Safe when nothing was loaded.
  @objc public func destroyRewarded(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      self?.rewardedManager.destroy()
      invoke.resolve()
    }
  }

  /// Creates and loads a banner attached to the Tauri root view.
  /// Resolves once the banner loaded and was revealed, rejects `LOAD_FAILED`
  /// otherwise (nothing stays attached after a failure).
  @objc public func showBanner(_ invoke: Invoke) throws {
    guard let args = decodeArgs(ShowBannerArgs.self, command: "showBanner", invoke: invoke) else {
      return
    }
    guard let adUnitId = args.adUnitId, !adUnitId.isEmpty else {
      invoke.reject("showBanner requires a non-empty `adUnitId`", code: "INVALID_ARGUMENT")
      return
    }
    guard let rawPosition = args.position,
      let parsedPosition = AdmobMappers.parseBannerPosition(rawPosition)
    else {
      invoke.reject(
        "showBanner requires `position` set to \"top\" or \"bottom\"", code: "INVALID_ARGUMENT")
      return
    }
    guard let rawSize = args.size, let parsedSize = AdmobMappers.parseBannerSize(rawSize) else {
      invoke.reject(
        "showBanner requires `size` set to \"banner\", \"largeBanner\", \"mediumRectangle\", "
          + "\"fullBanner\", \"leaderboard\" or \"adaptive\"",
        code: "INVALID_ARGUMENT")
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
        return
      }
      guard self.initialized else {
        invoke.reject("the plugin is not initialized; call initialize first", code: "NOT_INITIALIZED")
        return
      }
      self.bannerManager.show(
        adUnitId: adUnitId, position: parsedPosition, size: parsedSize, invoke: invoke)
    }
  }

  /// Hides the banner view (kept for a later re-show). Safe when there is none.
  @objc public func hideBanner(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      self?.bannerManager.hide()
      invoke.resolve()
    }
  }

  /// Repositions a live banner (no-op when there is none).
  @objc public func setBannerPosition(_ invoke: Invoke) throws {
    guard let args = decodeArgs(SetBannerPositionArgs.self, command: "setBannerPosition", invoke: invoke)
    else {
      return
    }
    guard let position = args.position,
      AdmobMappers.parseBannerPosition(position) != nil
    else {
      invoke.reject(
        "setBannerPosition requires `position` set to \"top\" or \"bottom\"",
        code: "INVALID_ARGUMENT")
      return
    }
    DispatchQueue.main.async { [weak self] in
      self?.bannerManager.setPosition(position)
      invoke.resolve()
    }
  }

  /// Removes the banner from the view hierarchy and clears its references.
  /// Safe when there is none.
  @objc public func destroyBanner(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      self?.bannerManager.destroy()
      invoke.resolve()
    }
  }

  /// Tears down banner, interstitial and rewarded ads. Must be safe when
  /// nothing was initialized.
  @objc public func destroy(_ invoke: Invoke) throws {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        invoke.resolve()
        return
      }
      self.bannerManager.destroy()
      self.interstitialManager.destroy()
      self.rewardedManager.destroy()
      // Mirrors the Rust core: destroy resets the initialization state so the
      // plugin can be initialized again.
      self.initialized = false
      self.initializationInFlight = false
      self.testing = false
      self.debugEnabled = false
      invoke.resolve()
    }
  }

  // MARK: - Initialization flow

  /// Contract `initialize` flow. Runs on the main queue.
  private func runInitialize(appId: String, args: InitializeArgs, invoke: Invoke) {
    // Idempotency mirrors the Rust core: a repeated initialize reports the
    // current status without re-running the SDK flows.
    if initialized {
      invoke.resolve([
        "consentStatus": ConsentManager.currentStatus(),
        "trackingStatus": trackingManager.currentStatus(),
      ])
      return
    }
    if initializationInFlight {
      invoke.reject("an initialize call is already in progress", code: "NATIVE_ERROR")
      return
    }

    // Contract step 2: the app-level AdMob App ID is owned by the consuming
    // app and read from Info.plist.
    guard
      let plistAppId = Bundle.main.object(forInfoDictionaryKey: Self.appIdentifierKey) as? String,
      !plistAppId.isEmpty
    else {
      invoke.reject(
        "missing \(Self.appIdentifierKey) in Info.plist; the Google Mobile Ads SDK aborts "
          + "without it. Add <key>\(Self.appIdentifierKey)</key>"
          + "<string>ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY</string> to the app target's "
          + "Info.plist",
        code: "INVALID_CONFIGURATION")
      return
    }
    if plistAppId != appId {
      // The SDK always uses the Info.plist value; keep going with a warning
      // (common in development, where isTesting resolves the Google test App ID).
      Logger.info(
        "WARNING: AdMob appId argument (\(appId)) differs from Info.plist "
          + "\(Self.appIdentifierKey) (\(plistAppId)); the SDK uses the Info.plist value",
        category: "admob")
    }

    debugEnabled = args.debug ?? false
    testing = args.isTesting ?? false
    let wantsConsent = args.automaticallyRequestConsent ?? false
    let wantsTracking = args.requestTrackingAuthorization ?? false
    initializationInFlight = true

    logDebug("starting Google Mobile Ads SDK (testing: \(testing))")
    // Contract step 3: start the SDK. We are already on the main queue; the
    // completion may arrive elsewhere, so it hops back before continuing.
    GADMobileAds.sharedInstance().start { [weak self] _ in
      DispatchQueue.main.async {
        guard let self else {
          invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
          return
        }
        self.continueAfterSdkStart(wantsConsent: wantsConsent, wantsTracking: wantsTracking, invoke: invoke)
      }
    }
  }

  /// Continues `initialize` after the SDK started: consent flow first.
  private func continueAfterSdkStart(wantsConsent: Bool, wantsTracking: Bool, invoke: Invoke) {
    if wantsConsent {
      guard let viewController = rootViewController() else {
        initializationInFlight = false
        invoke.reject(
          "no root view controller available to present the consent form", code: "NATIVE_ERROR")
        return
      }
      consentManager.requestConsent(from: viewController) { [weak self] result in
        // ConsentManager hops to the main queue before calling back.
        guard let self else {
          invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
          return
        }
        switch result {
        case .success(let status):
          self.trigger(AdmobEvents.CONSENT_CHANGED, data: ["status": status])
          self.requestTrackingThenFinish(wantsTracking: wantsTracking, invoke: invoke)
        case .failure(let flowError):
          self.initializationInFlight = false
          invoke.reject(flowError.message, code: "NATIVE_ERROR")
        }
      }
    } else {
      requestTrackingThenFinish(wantsTracking: wantsTracking, invoke: invoke)
    }
  }

  /// Continues `initialize` after consent: ATT request when asked for.
  private func requestTrackingThenFinish(wantsTracking: Bool, invoke: Invoke) {
    if wantsTracking {
      // ATT must be requested while the app is active; chaining it here (main
      // queue, inside the start() completion chain) guarantees that, and the
      // prompt shows after the consent form (if any) was dismissed.
      trackingManager.requestAuthorization { [weak self] status in
        // TrackingManager hops to the main queue before calling back.
        guard let self else {
          invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
          return
        }
        self.trigger(AdmobEvents.TRACKING_AUTHORIZATION_CHANGED, data: ["status": status])
        self.completeInitialization(trackingStatus: status, invoke: invoke)
      }
    } else {
      completeInitialization(trackingStatus: trackingManager.currentStatus(), invoke: invoke)
    }
  }

  /// Contract steps 5-6: trigger `admob://initialized`, resolve the status map.
  private func completeInitialization(trackingStatus: String, invoke: Invoke) {
    initializationInFlight = false
    initialized = true
    let consentStatus = ConsentManager.currentStatus()
    trigger(AdmobEvents.INITIALIZED, data: ["platform": "ios", "testing": testing])
    logDebug("initialized (consent: \(consentStatus), tracking: \(trackingStatus))")
    invoke.resolve(["consentStatus": consentStatus, "trackingStatus": trackingStatus])
  }

  // MARK: - Helpers

  /// Decodes the command arguments, rejecting with a stable `INVALID_ARGUMENT`
  /// code on failure. Returns nil after rejecting; callers must bail out.
  private func decodeArgs<T: Decodable>(_ type: T.Type, command: String, invoke: Invoke) -> T? {
    do {
      return try invoke.parseArgs(type)
    } catch {
      invoke.reject("invalid arguments for \(command): \(error)", code: "INVALID_ARGUMENT")
      return nil
    }
  }

  /// Root view controller used to present full-screen ads and consent forms:
  /// the Tauri plugin manager's view controller, falling back to the root of
  /// the window hosting the WebView.
  func rootViewController() -> UIViewController? {
    if let viewController = manager.viewController {
      return viewController
    }
    return webView?.window?.rootViewController
  }

  /// View the banner is attached to: the Tauri root view, falling back to the
  /// WebView's superview (captured in `load(webview:)`).
  func containerView() -> UIView? {
    if let view = manager.viewController?.view {
      return view
    }
    return webView?.superview
  }

  /// Logs a verbose message when `debug` was enabled through `initialize`.
  /// Never logs personal data.
  func logDebug(_ message: @autoclosure () -> String) {
    if debugEnabled {
      Logger.debug(message(), category: "admob")
    }
  }
}

/// Exported C symbol registered by the Rust core through
/// `register_ios_plugin(init_plugin_admob)` (`tauri::ios_plugin_binding!`).
@_cdecl("init_plugin_admob")
func initPlugin() -> Plugin {
  return AdmobPlugin()
}
