// Copyright 2026 tauri-plugin-ad2mob contributors
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import Foundation
import GoogleMobileAds
import Tauri
import UIKit

/// Lifecycle of the interstitial slot: load, present, full-screen events.
///
/// Threading: every command from `AdmobPlugin` arrives on the main queue and
/// every SDK callback hops to the main queue before touching state, so all
/// fields are main-queue-confined. Each pending `Invoke` is settled exactly
/// once (`show` on dismissal or presentation failure, each `load` by its own
/// completion closure).
final class InterstitialManager: NSObject, GADFullScreenContentDelegate {
  private weak var plugin: AdmobPlugin?
  /// Stored ad. Replaced by the newest successful load (concurrent loads are
  /// allowed), cleared on dismissal / presentation failure / destroy.
  private var interstitial: GADInterstitialAd?
  /// Ad unit of the most recent load, used for event payloads (the contract
  /// marks `adUnitId` optional in delegate events).
  private var adUnitId: String?
  /// The `show` invoke, settled exactly once on dismissal or presentation
  /// failure. Deliberately kept across `destroy()`: while a full-screen ad is
  /// on screen the SDK owns the presentation and always calls back.
  private var pendingShowInvoke: Invoke?
  /// Bumped by `destroy()` so loads started before it are discarded.
  private var generation = 0

  init(plugin: AdmobPlugin) {
    self.plugin = plugin
    super.init()
  }

  /// Loads a fresh interstitial. Each load settles its own invoke; the newest
  /// successful load replaces the stored ad. Called on the main queue.
  func load(adUnitId: String, invoke: Invoke) {
    let generation = self.generation

    GADInterstitialAd.load(
      withAdUnitID: adUnitId,
      request: GADRequest()
    ) { [weak self] ad, error in
      DispatchQueue.main.async {
        guard let self else {
          invoke.reject("plugin deallocated", code: "NATIVE_ERROR")
          return
        }
        if generation != self.generation {
          // destroy() ran while the load was in flight; settle the invoke and
          // drop the result.
          invoke.reject("interstitial destroyed while loading", code: "LOAD_FAILED")
          return
        }

        self.adUnitId = adUnitId
        if let ad {
          self.interstitial = ad
          // The delegate must be installed before the ad is presented.
          ad.fullScreenContentDelegate = self
          self.plugin?.logDebug("interstitial loaded")
          self.plugin?.trigger(AdmobEvents.INTERSTITIAL_LOADED, data: ["adUnitId": adUnitId])
          invoke.resolve()
        } else if let error {
          let nsError = error as NSError
          let payload: JSObject = [
            "adUnitId": adUnitId,
            "code": "\(nsError.code)",
            "message": error.localizedDescription,
            "domain": nsError.domain,
            "stage": "load",
          ]
          self.plugin?.trigger(AdmobEvents.INTERSTITIAL_FAILED, data: payload)
          invoke.reject(
            "failed to load interstitial: \(error.localizedDescription)", code: "LOAD_FAILED")
        } else {
          // Defensive: the SDK is expected to always provide ad or error.
          invoke.reject(
            "Google Mobile Ads SDK returned neither an ad nor an error", code: "NATIVE_ERROR")
        }
      }
    }
  }

  /// Presents the stored interstitial. Rejects `AD_NOT_READY` when nothing is
  /// loaded. Called on the main queue.
  func show(invoke: Invoke) {
    guard let interstitial = self.interstitial else {
      invoke.reject("no interstitial is loaded; call loadInterstitial first", code: "AD_NOT_READY")
      return
    }
    if pendingShowInvoke != nil {
      invoke.reject("another interstitial show is still in progress", code: "NATIVE_ERROR")
      return
    }
    guard let rootViewController = plugin?.rootViewController() else {
      invoke.reject(
        "no root view controller available to present the interstitial", code: "NATIVE_ERROR")
      return
    }

    pendingShowInvoke = invoke
    interstitial.present(fromRootViewController: rootViewController)
  }

  /// Clears the stored ad and event state. A show still on screen settles
  /// through the SDK dismissal callbacks (the SDK owns the presentation).
  /// Safe when nothing was loaded. Called on the main queue.
  func destroy() {
    generation += 1
    interstitial?.fullScreenContentDelegate = nil
    interstitial = nil
    adUnitId = nil
  }

  // MARK: - GADFullScreenContentDelegate

  func adDidRecordImpression(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      self?.triggerEvent(AdmobEvents.INTERSTITIAL_IMPRESSION)
    }
  }

  func adDidRecordClick(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      self?.triggerEvent(AdmobEvents.INTERSTITIAL_CLICKED)
    }
  }

  func adWillPresentFullScreenContent(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      self?.triggerEvent(AdmobEvents.INTERSTITIAL_OPENED)
      self?.plugin?.logDebug("interstitial presented")
    }
  }

  func adDidDismissFullScreenContent(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      (ad as? GADInterstitialAd)?.fullScreenContentDelegate = nil
      self.interstitial = nil
      self.triggerEvent(AdmobEvents.INTERSTITIAL_CLOSED)
      self.pendingShowInvoke?.resolve()
      self.pendingShowInvoke = nil
    }
  }

  func ad(_ ad: GADFullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      (ad as? GADInterstitialAd)?.fullScreenContentDelegate = nil
      self.interstitial = nil
      let nsError = error as NSError
      var payload = self.eventPayload()
      payload["code"] = "\(nsError.code)"
      payload["message"] = error.localizedDescription
      payload["domain"] = nsError.domain
      payload["stage"] = "show"
      self.plugin?.trigger(AdmobEvents.INTERSTITIAL_FAILED, data: payload)
      self.pendingShowInvoke?.reject(
        "failed to present interstitial: \(error.localizedDescription)", code: "SHOW_FAILED")
      self.pendingShowInvoke = nil
    }
  }

  // MARK: - Private

  /// Base payload for delegate events: the ad unit of the most recent load.
  private func eventPayload() -> JSObject {
    var payload: JSObject = [:]
    if let adUnitId {
      payload["adUnitId"] = adUnitId
    }
    return payload
  }

  private func triggerEvent(_ event: String) {
    plugin?.trigger(event, data: eventPayload())
  }
}
