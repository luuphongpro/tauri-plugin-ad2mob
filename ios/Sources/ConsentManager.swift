// Copyright 2026 tauri-plugin-ad2mob contributors
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

import Foundation
import UIKit
import UserMessagingPlatform

/// Error surfaced by the consent flow. The message (including the UMP SDK
/// description) is embedded into the `NATIVE_ERROR` rejection sent to Rust —
/// rejections only ever carry `{ code, message }`.
struct AdmobFlowError: Error {
  let message: String
}

/// Google UMP consent flow.
///
/// Runs `UMPConsentInformation.requestConsentInfoUpdate` and, when the region
/// requires it, presents the consent form through
/// `UMPConsentForm.loadAndShowIfRequired`. The resulting `UMPConsentStatus` is
/// normalized through `AdmobMappers` so Rust and the guest bindings always see
/// the contract strings (`unknown` / `required` / `notRequired` / `obtained`).
final class ConsentManager: NSObject {
  /// Runs the UMP flow from `viewController`. The completion is always called
  /// exactly once, on the main queue, with the normalized status or the SDK
  /// error description.
  func requestConsent(
    from viewController: UIViewController,
    completion: @escaping (Result<String, AdmobFlowError>) -> Void
  ) {
    let parameters = UMPRequestParameters()
    parameters.tagForUnderAgeOfConsent = false

    UMPConsentInformation.sharedInstance.requestConsentInfoUpdate(with: parameters) { error in
      DispatchQueue.main.async {
        if let error {
          completion(
            .failure(
              AdmobFlowError(
                message: "UMP consent info update failed: \(error.localizedDescription)")))
          return
        }

        UMPConsentForm.loadAndPresentIfRequired(from: viewController) { formError in
          DispatchQueue.main.async {
            if let formError {
              completion(
                .failure(
                  AdmobFlowError(message: "UMP consent form failed: \(formError.localizedDescription)")))
              return
            }
            completion(.success(Self.currentStatus()))
          }
        }
      }
    }
  }

  /// Normalized current consent status without running the flow.
  static func currentStatus() -> String {
    AdmobMappers.consentStatus(
      fromUmpRawValue: UMPConsentInformation.sharedInstance.consentStatus.rawValue)
  }
}
