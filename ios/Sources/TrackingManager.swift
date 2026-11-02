// Copyright 2026 tauri-plugin-ad2mob contributors
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import AppTrackingTransparency
import Foundation

/// App Tracking Transparency helper.
///
/// ATT only exists on iOS 14+; on older runtimes (and whenever the status
/// cannot be read) the plugin reports the contract's `"notAvailable"` value
/// through `AdmobMappers.trackingStatus(fromAttRawValue: nil)`.
///
/// The system ATT prompt is only shown while the app is active, so callers
/// must run `requestAuthorization` from the main queue (the plugin chains it
/// inside the `GADMobileAds.start` completion, which hops to the main queue).
final class TrackingManager {
  /// Normalized current authorization status without prompting:
  /// `notDetermined` / `restricted` / `denied` / `authorized` / `notAvailable`.
  func currentStatus() -> String {
    if #available(iOS 14, *) {
      return AdmobMappers.trackingStatus(
        fromAttRawValue: Int(ATTrackingManager.trackingAuthorizationStatus.rawValue))
    }
    return AdmobMappers.trackingStatus(fromAttRawValue: nil)
  }

  /// Prompts the user for tracking authorization and reports the normalized
  /// status through `completion` on the main queue, exactly once.
  func requestAuthorization(completion: @escaping (_ status: String) -> Void) {
    if #available(iOS 14, *) {
      ATTrackingManager.requestTrackingAuthorization { status in
        let normalized = AdmobMappers.trackingStatus(fromAttRawValue: Int(status.rawValue))
        // The completion may arrive off the main queue; the prompt result is
        // UI-related state, so hop before reporting.
        DispatchQueue.main.async {
          completion(normalized)
        }
      }
    } else {
      completion(AdmobMappers.trackingStatus(fromAttRawValue: nil))
    }
  }
}
