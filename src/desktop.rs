//! Desktop stub.
//!
//! The plugin compiles for Windows, macOS and Linux so Tauri desktop builds of
//! apps that also target mobile keep working, but Google Mobile Ads only
//! exists on Android and iOS. Ad operations therefore return a controlled
//! [`Error::UnsupportedPlatform`] instead of breaking the build or crashing.

use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::error::Result;
use crate::models::{
    BannerPosition, NativeConsentResult, NativeInitializePayload, NativeInitializeResult,
    NativeTrackingResult, TrackingAuthorizationStatus,
};

pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Admob<R>> {
    Ok(Admob {
        _marker: std::marker::PhantomData,
    })
}

/// Desktop counterpart of the mobile [`crate::mobile::Admob`] transport.
///
/// `PhantomData<fn() -> R>` keeps the wrapper `Send + Sync` for every runtime
/// without requiring those bounds on `R` itself.
pub struct Admob<R: Runtime> {
    _marker: std::marker::PhantomData<fn() -> R>,
}

impl<R: Runtime> Admob<R> {
    fn unsupported<T>() -> Result<T> {
        Err(crate::Error::unsupported_current_platform())
    }

    /// No-op success: desktop apps can call `initialize()` unconditionally.
    pub async fn initialize(
        &self,
        _payload: NativeInitializePayload,
    ) -> Result<NativeInitializeResult> {
        Ok(NativeInitializeResult {
            consent_status: crate::models::ConsentStatus::Unknown,
            tracking_status: TrackingAuthorizationStatus::NotAvailable,
        })
    }

    pub async fn request_consent(&self) -> Result<NativeConsentResult> {
        Self::unsupported()
    }

    /// ATT only exists on iOS; other platforms report `notAvailable`.
    pub async fn request_tracking_authorization(&self) -> Result<NativeTrackingResult> {
        Ok(NativeTrackingResult {
            status: TrackingAuthorizationStatus::NotAvailable,
        })
    }

    pub async fn load_interstitial(&self, _ad_unit_id: String) -> Result<()> {
        Self::unsupported()
    }

    pub async fn show_interstitial(&self) -> Result<()> {
        Self::unsupported()
    }

    pub async fn destroy_interstitial(&self) -> Result<()> {
        Self::unsupported()
    }

    pub async fn load_rewarded(&self, _ad_unit_id: String) -> Result<()> {
        Self::unsupported()
    }

    pub async fn show_rewarded(
        &self,
        _payload: crate::models::NativeShowRewardedPayload,
    ) -> Result<()> {
        Self::unsupported()
    }

    pub async fn destroy_rewarded(&self) -> Result<()> {
        Self::unsupported()
    }

    pub async fn show_banner(
        &self,
        _payload: crate::models::NativeShowBannerPayload,
    ) -> Result<()> {
        Self::unsupported()
    }

    pub async fn hide_banner(&self) -> Result<()> {
        Self::unsupported()
    }

    pub async fn set_banner_position(&self, _position: BannerPosition) -> Result<()> {
        Self::unsupported()
    }

    pub async fn destroy_banner(&self) -> Result<()> {
        Self::unsupported()
    }

    pub async fn destroy(&self) -> Result<()> {
        Ok(())
    }
}
