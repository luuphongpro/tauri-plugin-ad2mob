//! Tauri commands exposed to the guest bindings as `plugin:ad2mob|<command>`.
//!
//! Commands are deliberately thin: argument validation, ad unit resolution and
//! state transitions live in [`crate::state`] (pure and unit tested), while the
//! platform dependent transport lives in [`crate::mobile`] / [`crate::desktop`].

use tauri::{command, AppHandle, Manager, Runtime, State};

#[cfg(desktop)]
use tauri::Emitter;

use crate::error::Result;
#[cfg(desktop)]
use crate::models::{events, InitializedEvent};
#[cfg(mobile)]
use crate::models::{AdFormat, NativeShowBannerPayload, NativeShowRewardedPayload};
use crate::models::{
    AdMobConfig, AdMobStatus, ConfigureOptions, ConsentResult, InitializationResult, LoadAdOptions,
    NativeInitializePayload, Platform, SetBannerPositionOptions, ShowBannerOptions,
    ShowRewardedOptions, TrackingAuthorizationResult,
};
use crate::state::SharedState;
use crate::AdMobExt;

fn log_debug(state: &SharedState, message: &str) {
    if state.lock().config.debug {
        log::debug!(target: "tauri_plugin_ad2mob", "{message}");
    }
}

/// Runs `initialize` with the configuration captured from `tauri.conf.json`.
pub(crate) async fn initialize_on_startup<R: Runtime>(app: AppHandle<R>) {
    let state = app.state::<SharedState>();
    let result = initialize_internal(&app, state.inner(), None).await;
    match result {
        Ok(result) => log::info!(
            target: "tauri_plugin_ad2mob",
            "initialized on startup (platform: {}, testing: {})",
            result.platform,
            result.testing
        ),
        Err(error) => log::error!(
            target: "tauri_plugin_ad2mob",
            "initialize_on_startup failed: {error}"
        ),
    }
}

async fn initialize_internal<R: Runtime>(
    app: &AppHandle<R>,
    state: &SharedState,
    options: Option<AdMobConfig>,
) -> Result<InitializationResult> {
    let platform = Platform::current();

    // Idempotency: a second `initialize()` never runs the native flow again.
    {
        let mut inner = state.lock();
        if inner.initialized {
            log_debug(state, "initialize called again; already initialized");
            return Ok(InitializationResult {
                initialized: true,
                platform,
                testing: inner.config.is_testing,
            });
        }

        let config = options.unwrap_or_else(|| inner.config.clone());
        config.validate(platform)?;
        inner.config = config;
        inner.initialized = true;
    }

    let payload = {
        let config = state.lock().config.clone();
        NativeInitializePayload {
            app_id: config.effective_app_id(platform).unwrap_or_default(),
            is_testing: config.is_testing,
            automatically_request_consent: config.automatically_request_consent,
            request_tracking_authorization: config.request_tracking_authorization,
            debug: config.debug,
        }
    };

    let native_result = app.admob().initialize(payload).await;

    match native_result {
        Ok(result) => {
            let mut inner = state.lock();
            inner.consent_status = result.consent_status;
            inner.tracking_status = result.tracking_status;
        }
        Err(error) => {
            // Roll back so a failed initialization can be retried.
            let mut inner = state.lock();
            inner.initialized = false;
            return Err(error);
        }
    }

    let testing = state.lock().config.is_testing;

    // On mobile the native layer triggers `admob://initialized` through the
    // plugin event channel; desktop has no native layer so the Rust core emits
    // the event on the global event system (guest code uses `listen` there).
    #[cfg(desktop)]
    if let Err(error) = app.emit(events::INITIALIZED, InitializedEvent { platform, testing }) {
        log::warn!(target: "tauri_plugin_ad2mob", "failed to emit initialized event: {error}");
    }

    log_debug(state, "initialize completed");
    Ok(InitializationResult {
        initialized: true,
        platform,
        testing,
    })
}

#[command]
pub(crate) async fn initialize<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
    options: Option<AdMobConfig>,
) -> Result<InitializationResult> {
    initialize_internal(&app, state.inner(), options).await
}

#[command]
pub(crate) async fn configure(
    state: State<'_, SharedState>,
    options: ConfigureOptions,
) -> Result<()> {
    // Validate every provided ID before touching the state.
    if let Some(banner) = options.ad_unit_ids.banner.as_deref() {
        crate::state::validate_ad_unit_id(banner)?;
    }
    if let Some(interstitial) = options.ad_unit_ids.interstitial.as_deref() {
        crate::state::validate_ad_unit_id(interstitial)?;
    }
    if let Some(rewarded) = options.ad_unit_ids.rewarded.as_deref() {
        crate::state::validate_ad_unit_id(rewarded)?;
    }

    let mut inner = state.lock();
    inner.ad_unit_ids.merge(options.ad_unit_ids);
    Ok(())
}

#[command]
pub(crate) fn is_supported() -> bool {
    Platform::current().supports_ads()
}

#[command]
pub(crate) fn get_status(state: State<'_, SharedState>) -> Result<AdMobStatus> {
    let inner = state.lock();
    Ok(AdMobStatus {
        initialized: inner.initialized,
        platform: Platform::current(),
        testing: inner.config.is_testing,
        consent_status: inner.consent_status,
        tracking_status: inner.tracking_status,
        interstitial_ready: inner.interstitial.is_ready(),
        rewarded_ready: inner.rewarded.is_ready(),
        banner_visible: inner.banner.is_visible(),
    })
}

#[command]
pub(crate) fn get_consent_status(state: State<'_, SharedState>) -> Result<ConsentResult> {
    Ok(ConsentResult {
        status: state.lock().consent_status,
    })
}

#[command]
pub(crate) fn get_tracking_authorization_status(
    state: State<'_, SharedState>,
) -> Result<TrackingAuthorizationResult> {
    Ok(TrackingAuthorizationResult {
        status: state.lock().tracking_status,
    })
}

#[command]
pub(crate) async fn request_consent<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<ConsentResult> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        let status = app.admob().request_consent().await?.status;
        state.lock().consent_status = status;
        log_debug(&state, "consent updated");
        Ok(ConsentResult { status })
    }
}

#[command]
pub(crate) async fn request_tracking_authorization<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<TrackingAuthorizationResult> {
    // Desktop resolves `notAvailable` through the stub; ATT only exists on iOS.
    let status = app.admob().request_tracking_authorization().await?.status;
    state.lock().tracking_status = status;
    Ok(TrackingAuthorizationResult { status })
}

// ---------------------------------------------------------------------------
// Interstitial
// ---------------------------------------------------------------------------

#[command]
pub(crate) async fn load_interstitial<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
    options: Option<LoadAdOptions>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state, &options);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        let platform = Platform::current();
        let ad_unit_id = {
            let mut inner = state.lock();
            inner.ensure_initialized()?;
            inner.ensure_consent_allows_ads()?;
            let explicit = options.and_then(|o| o.ad_unit_id);
            let ad_unit_id =
                inner.resolve_ad_unit_id(explicit, AdFormat::Interstitial, platform)?;
            inner.interstitial.begin_load();
            ad_unit_id
        };

        match app.admob().load_interstitial(ad_unit_id.clone()).await {
            Ok(()) => {
                state.lock().interstitial.on_loaded(ad_unit_id);
                log_debug(&state, "interstitial loaded");
                Ok(())
            }
            Err(error) => {
                state.lock().interstitial.on_load_failed();
                Err(error)
            }
        }
    }
}

#[command]
pub(crate) async fn show_interstitial<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        {
            let mut inner = state.lock();
            inner.ensure_initialized()?;
            inner.ensure_consent_allows_ads()?;
            inner.interstitial.begin_show()?;
        }

        // Resolves once the ad has been dismissed by the user.
        match app.admob().show_interstitial().await {
            Ok(()) => {
                state.lock().interstitial.on_dismissed();
                Ok(())
            }
            Err(error) => {
                state.lock().interstitial.on_show_failed();
                Err(error)
            }
        }
    }
}

#[command]
pub(crate) fn is_interstitial_ready(state: State<'_, SharedState>) -> bool {
    state.lock().interstitial.is_ready()
}

#[command]
pub(crate) async fn destroy_interstitial<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        app.admob().destroy_interstitial().await?;
        state.lock().interstitial.destroy();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Rewarded
// ---------------------------------------------------------------------------

#[command]
pub(crate) async fn load_rewarded<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
    options: Option<LoadAdOptions>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state, &options);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        let platform = Platform::current();
        let ad_unit_id = {
            let mut inner = state.lock();
            inner.ensure_initialized()?;
            inner.ensure_consent_allows_ads()?;
            let explicit = options.and_then(|o| o.ad_unit_id);
            let ad_unit_id = inner.resolve_ad_unit_id(explicit, AdFormat::Rewarded, platform)?;
            inner.rewarded.begin_load();
            ad_unit_id
        };

        match app.admob().load_rewarded(ad_unit_id.clone()).await {
            Ok(()) => {
                state.lock().rewarded.on_loaded(ad_unit_id);
                log_debug(&state, "rewarded loaded");
                Ok(())
            }
            Err(error) => {
                state.lock().rewarded.on_load_failed();
                Err(error)
            }
        }
    }
}

#[command]
pub(crate) async fn show_rewarded<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
    options: Option<ShowRewardedOptions>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state, &options);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        {
            let mut inner = state.lock();
            inner.ensure_initialized()?;
            inner.ensure_consent_allows_ads()?;
            inner.rewarded.begin_show()?;
        }

        let opts = options.unwrap_or_default();
        let payload = NativeShowRewardedPayload {
            user_id: opts.user_id,
            custom_data: opts.custom_data,
        };

        // Resolves once the ad has been dismissed. The reward itself is always
        // delivered through `admob://rewarded-earned` from the SDK callback.
        match app.admob().show_rewarded(payload).await {
            Ok(()) => {
                state.lock().rewarded.on_dismissed();
                Ok(())
            }
            Err(error) => {
                state.lock().rewarded.on_show_failed();
                Err(error)
            }
        }
    }
}

#[command]
pub(crate) fn is_rewarded_ready(state: State<'_, SharedState>) -> bool {
    state.lock().rewarded.is_ready()
}

#[command]
pub(crate) async fn destroy_rewarded<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        app.admob().destroy_rewarded().await?;
        state.lock().rewarded.destroy();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

#[command]
pub(crate) async fn show_banner<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
    options: Option<ShowBannerOptions>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state, &options);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        let platform = Platform::current();
        let payload = {
            let mut inner = state.lock();
            inner.ensure_initialized()?;
            inner.ensure_consent_allows_ads()?;
            let options = options.unwrap_or_default();
            let ad_unit_id =
                inner.resolve_ad_unit_id(options.ad_unit_id, AdFormat::Banner, platform)?;
            let position = options.position.unwrap_or_default();
            let size = options.size.unwrap_or_default();
            inner.banner.position = position;
            inner.banner.size = size;
            inner.banner.begin_load();
            NativeShowBannerPayload {
                ad_unit_id,
                position,
                size,
            }
        };

        // Resolves once the banner is loaded and attached to the view hierarchy.
        match app.admob().show_banner(payload.clone()).await {
            Ok(()) => {
                state.lock().banner.on_loaded(payload.ad_unit_id);
                log_debug(&state, "banner shown");
                Ok(())
            }
            Err(error) => {
                state.lock().banner.on_load_failed();
                Err(error)
            }
        }
    }
}

#[command]
pub(crate) async fn hide_banner<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        app.admob().hide_banner().await?;
        state.lock().banner.hide();
        Ok(())
    }
}

#[command]
pub(crate) fn is_banner_visible(state: State<'_, SharedState>) -> bool {
    state.lock().banner.is_visible()
}

#[command]
pub(crate) async fn set_banner_position<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
    options: SetBannerPositionOptions,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state, &options);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        app.admob().set_banner_position(options.position).await?;
        state.lock().banner.position = options.position;
        Ok(())
    }
}

#[command]
pub(crate) async fn destroy_banner<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<()> {
    #[cfg(desktop)]
    {
        let _ = (&app, &state);
        Err(crate::Error::unsupported_current_platform())
    }

    #[cfg(mobile)]
    {
        app.admob().destroy_banner().await?;
        state.lock().banner.destroy();
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Global cleanup
// ---------------------------------------------------------------------------

#[command]
pub(crate) async fn destroy<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SharedState>,
) -> Result<()> {
    // Best effort: even when the native cleanup fails the Rust state is reset
    // so the plugin stays consistent and can be initialized again.
    if let Err(error) = app.admob().destroy().await {
        log::warn!(target: "tauri_plugin_ad2mob", "native destroy failed: {error}");
    }

    {
        let mut inner = state.lock();
        inner.interstitial.destroy();
        inner.rewarded.destroy();
        inner.banner.destroy();
        inner.initialized = false;
    }

    log_debug(&state, "plugin destroyed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        AdErrorEvent, AdEvent, AdLoadedEvent, ConsentChangedEvent, ConsentStatus, Reward,
        RewardEarnedEvent, TrackingAuthorizationChangedEvent, TrackingAuthorizationStatus,
    };
    use crate::state::{test_util::initialized_state, AdSlotState, BannerState};

    #[test]
    fn status_snapshot_matches_state() {
        let mut inner = initialized_state();
        inner.interstitial.state = AdSlotState::Ready;
        inner.banner.state = BannerState::Visible;
        inner.tracking_status = TrackingAuthorizationStatus::Authorized;

        let status = AdMobStatus {
            initialized: inner.initialized,
            platform: Platform::current(),
            testing: inner.config.is_testing,
            consent_status: inner.consent_status,
            tracking_status: inner.tracking_status,
            interstitial_ready: inner.interstitial.is_ready(),
            rewarded_ready: inner.rewarded.is_ready(),
            banner_visible: inner.banner.is_visible(),
        };

        assert!(status.interstitial_ready);
        assert!(!status.rewarded_ready);
        assert!(status.banner_visible);
        assert_eq!(
            status.tracking_status,
            TrackingAuthorizationStatus::Authorized
        );

        let json = serde_json::to_value(&status).unwrap();
        assert!(json.get("consentStatus").is_some());
        assert!(json.get("interstitialReady").is_some());
    }

    #[test]
    fn event_payloads_serialize_camel_case() {
        let loaded = serde_json::to_value(AdLoadedEvent {
            ad_unit_id: "ca-app-pub-3940256099942544/6300978111".into(),
        })
        .unwrap();
        assert_eq!(loaded["adUnitId"], "ca-app-pub-3940256099942544/6300978111");

        let reward = serde_json::to_value(RewardEarnedEvent {
            ad_unit_id: None,
            reward: Reward {
                amount: 10.0,
                kind: "coins".into(),
            },
        })
        .unwrap();
        assert_eq!(reward["amount"], 10.0);
        assert_eq!(reward["type"], "coins");
        assert!(reward.get("adUnitId").is_none());

        let failed = serde_json::to_value(AdErrorEvent {
            stage: Some(crate::models::AdFailureStage::Show),
            message: "show failed".into(),
            ..AdErrorEvent::default()
        })
        .unwrap();
        assert_eq!(failed["stage"], "show");

        let event = serde_json::to_value(AdEvent::default()).unwrap();
        assert_eq!(event, serde_json::json!({}));

        let consent = serde_json::to_value(ConsentChangedEvent {
            status: ConsentStatus::Obtained,
        })
        .unwrap();
        assert_eq!(consent["status"], "obtained");

        let tracking = serde_json::to_value(TrackingAuthorizationChangedEvent {
            status: TrackingAuthorizationStatus::Denied,
        })
        .unwrap();
        assert_eq!(tracking["status"], "denied");

        let configure: ConfigureOptions = serde_json::from_value(serde_json::json!({
            "adUnitIds": { "banner": "ca-app-pub-1111111111/2222222222" }
        }))
        .unwrap();
        assert_eq!(
            configure.ad_unit_ids.banner.as_deref(),
            Some("ca-app-pub-1111111111/2222222222")
        );

        assert_eq!(events::INITIALIZED, "admob://initialized");
        assert_eq!(events::REWARDED_EARNED, "admob://rewarded-earned");

        let shared = SharedState::new();
        assert!(shared.lock().ensure_initialized().is_err());
        shared.lock().initialized = true;
        assert!(shared.lock().ensure_initialized().is_ok());
    }
}
