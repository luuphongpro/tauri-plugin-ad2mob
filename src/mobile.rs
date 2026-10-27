//! Mobile entrypoint: registers the Kotlin/Swift plugin classes and exposes the
//! typed transport used by the commands.
//!
//! All native calls use [`tauri::plugin::PluginHandle::run_mobile_plugin_async`]
//! so the async Tauri runtime is never blocked while an ad SDK operation is in
//! flight (loads can legitimately take seconds on poor connections).

use serde::de::DeserializeOwned;
use tauri::{
    plugin::{PluginApi, PluginHandle},
    AppHandle, Runtime,
};

use crate::error::Result;
use crate::models::{
    BannerPosition, NativeConsentResult, NativeInitializePayload, NativeInitializeResult,
    NativeLoadAdPayload, NativeSetBannerPositionPayload, NativeShowBannerPayload,
    NativeShowRewardedPayload, NativeTrackingResult,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.plugin.admob";

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_admob);

/// Initializes the Kotlin or Swift plugin class.
pub fn init<R: Runtime, C: DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> crate::Result<Admob<R>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AdmobPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_admob)?;
    Ok(Admob { handle })
}

/// Access to the native AdMob layer.
pub struct Admob<R: Runtime> {
    handle: PluginHandle<R>,
}

impl<R: Runtime> Admob<R> {
    async fn call<P: serde::Serialize, T: DeserializeOwned>(
        &self,
        method: &'static str,
        payload: P,
    ) -> Result<T> {
        self.handle
            .run_mobile_plugin_async(method, payload)
            .await
            .map_err(crate::Error::from)
    }

    /// Ignores the (null) response of native commands that return nothing.
    /// `serde_json::Value` accepts any resolved shape defensively.
    async fn call_unit<P: serde::Serialize>(&self, method: &'static str, payload: P) -> Result<()> {
        let _: serde_json::Value = self.call(method, payload).await?;
        Ok(())
    }

    pub async fn initialize(
        &self,
        payload: NativeInitializePayload,
    ) -> Result<NativeInitializeResult> {
        self.call("initialize", payload).await
    }

    pub async fn request_consent(&self) -> Result<NativeConsentResult> {
        self.call("requestConsent", ()).await
    }

    pub async fn request_tracking_authorization(&self) -> Result<NativeTrackingResult> {
        self.call("requestTrackingAuthorization", ()).await
    }

    pub async fn load_interstitial(&self, ad_unit_id: String) -> Result<()> {
        self.call_unit("loadInterstitial", NativeLoadAdPayload { ad_unit_id })
            .await
    }

    pub async fn show_interstitial(&self) -> Result<()> {
        self.call_unit("showInterstitial", ()).await
    }

    pub async fn destroy_interstitial(&self) -> Result<()> {
        self.call_unit("destroyInterstitial", ()).await
    }

    pub async fn load_rewarded(&self, ad_unit_id: String) -> Result<()> {
        self.call_unit("loadRewarded", NativeLoadAdPayload { ad_unit_id })
            .await
    }

    pub async fn show_rewarded(&self, payload: NativeShowRewardedPayload) -> Result<()> {
        self.call_unit("showRewarded", payload).await
    }

    pub async fn destroy_rewarded(&self) -> Result<()> {
        self.call_unit("destroyRewarded", ()).await
    }

    pub async fn show_banner(&self, payload: NativeShowBannerPayload) -> Result<()> {
        self.call_unit("showBanner", payload).await
    }

    pub async fn hide_banner(&self) -> Result<()> {
        self.call_unit("hideBanner", ()).await
    }

    pub async fn set_banner_position(&self, position: BannerPosition) -> Result<()> {
        self.call_unit(
            "setBannerPosition",
            NativeSetBannerPositionPayload { position },
        )
        .await
    }

    pub async fn destroy_banner(&self) -> Result<()> {
        self.call_unit("destroyBanner", ()).await
    }

    pub async fn destroy(&self) -> Result<()> {
        self.call_unit("destroy", ()).await
    }
}
