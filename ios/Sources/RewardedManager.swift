// Copyright 2026 tauri-plugin-ad2mob contributors
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import Foundation
import GoogleMobileAds
import Tauri
import UIKit

/// Lifecycle of the rewarded slot: load, present, full-screen events and the
/// real SDK reward callback.
///
/// Threading: every command from `AdmobPlugin` arrives on the main queue and
/// every SDK callback hops to the main queue before touching state, so all
/// fields are main-queue-confined. Each pending `Invoke` is settled exactly
/// once.
///
/// The reward is delivered exclusively through the real
/// `GADRewardedAdDelegate` callback — never synthesized from dismissal.
final class RewardedManager: NSObject, GADRewardedAdDelegate {
  private weak var plugin: AdmobPlugin?
  /// Stored ad. Replaced by the newest successful load (concurrent loads are
  /// allowed), cleared on dismissal / presentation failure / destroy.
  private var rewarded: GADRewardedAd?
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

  /// Loads a fresh rewarded ad. Each load settles its own invoke; the newest
  /// successful load replaces the stored ad. Called on the main queue.
  func load(adUnitId: String, invoke: Invoke) {
    let generation = self.generation

    GADRewardedAd.load(
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
          invoke.reject("rewarded ad destroyed while loading", code: "LOAD_FAILED")
          return
        }

        self.adUnitId = adUnitId
        if let ad {
          self.rewarded = ad
          // The delegate must be installed before the ad is presented.
          // GADRewardedAdDelegate refines GADFullScreenContentDelegate, so a
          // single delegate receives the presentation events AND the reward;
          // setting `fullScreenContentDelegate` as well would duplicate the
          // presentation callbacks.
          ad.delegate = self
          self.plugin?.logDebug("rewarded ad loaded")
          self.plugin?.trigger(AdmobEvents.REWARDED_LOADED, data: ["adUnitId": adUnitId])
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
          self.plugin?.trigger(AdmobEvents.REWARDED_FAILED, data: payload)
          invoke.reject(
            "failed to load rewarded ad: \(error.localizedDescription)", code: "LOAD_FAILED")
        } else {
          // Defensive: the SDK is expected to always provide ad or error.
          invoke.reject(
            "Google Mobile Ads SDK returned neither an ad nor an error", code: "NATIVE_ERROR")
        }
      }
    }
  }

  /// Presents the stored rewarded ad. Rejects `AD_NOT_READY` when nothing is
  /// loaded. Called on the main queue.
  func show(userId: String? = nil, customData: String? = nil, invoke: Invoke) {
    guard let rewarded = self.rewarded else {
      invoke.reject("no rewarded ad is loaded; call loadRewarded first", code: "AD_NOT_READY")
      return
    }
    if pendingShowInvoke != nil {
      invoke.reject("another rewarded show is still in progress", code: "NATIVE_ERROR")
      return
    }
    guard let rootViewController = plugin?.rootViewController() else {
      invoke.reject(
        "no root view controller available to present the rewarded ad", code: "NATIVE_ERROR")
      return
    }

    let hasUserId = userId != nil && !userId!.isEmpty
    let hasCustomData = customData != nil && !customData!.isEmpty
    if hasUserId || hasCustomData {
      let ssvOptions = GADServerSideVerificationOptions()
      if let userId, !userId.isEmpty {
        ssvOptions.userIdentifier = userId
      }
      if let customData, !customData.isEmpty {
        ssvOptions.customRewardString = customData
      }
      rewarded.serverSideVerificationOptions = ssvOptions
    }

    pendingShowInvoke = invoke
    rewarded.present(fromRootViewController: rootViewController)
  }

  /// Clears the stored ad and event state. A show still on screen settles
  /// through the SDK dismissal callbacks (the SDK owns the presentation).
  /// Safe when nothing was loaded. Called on the main queue.
  func destroy() {
    generation += 1
    rewarded?.delegate = nil
    rewarded = nil
    adUnitId = nil
  }

  // MARK: - GADRewardedAdDelegate

  /// Real SDK reward callback, fired when the user actually earns the reward.
  func rewardedAd(_ rewardedAd: GADRewardedAd, userDidEarnReward reward: GADAdReward) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      var payload = self.eventPayload()
      payload["amount"] = reward.amount.doubleValue
      payload["type"] = reward.type
      self.plugin?.trigger(AdmobEvents.REWARDED_EARNED, data: payload)
      self.plugin?.logDebug("reward earned: \(reward.amount) \(reward.type)")
    }
  }

  // MARK: - GADFullScreenContentDelegate (inherited by GADRewardedAdDelegate)

  func adDidRecordImpression(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      self?.triggerEvent(AdmobEvents.REWARDED_IMPRESSION)
    }
  }

  func adDidRecordClick(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      self?.triggerEvent(AdmobEvents.REWARDED_CLICKED)
    }
  }

  func adDidPresentFullScreenContent(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      self?.triggerEvent(AdmobEvents.REWARDED_OPENED)
      self?.plugin?.logDebug("rewarded ad presented")
    }
  }

  func adDidDismissFullScreenContent(_ ad: GADFullScreenPresentingAd) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      (ad as? GADRewardedAd)?.delegate = nil
      self.rewarded = nil
      self.triggerEvent(AdmobEvents.REWARDED_CLOSED)
      self.pendingShowInvoke?.resolve()
      self.pendingShowInvoke = nil
    }
  }

  func ad(_ ad: GADFullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      (ad as? GADRewardedAd)?.delegate = nil
      self.rewarded = nil
      let nsError = error as NSError
      var payload = self.eventPayload()
      payload["code"] = "\(nsError.code)"
      payload["message"] = error.localizedDescription
      payload["domain"] = nsError.domain
      payload["stage"] = "show"
      self.plugin?.trigger(AdmobEvents.REWARDED_FAILED, data: payload)
      self.pendingShowInvoke?.reject(
        "failed to present rewarded ad: \(error.localizedDescription)", code: "SHOW_FAILED")
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
