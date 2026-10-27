//! Integration tests exercising the plugin's public API surface.
//!
//! These tests only use items reachable from the crate root, exactly like a
//! consumer crate would, so they also guard against accidental private-API
//! regressions.

use tauri_plugin_ad2mob::{
    test_ids, validate, AdFormat, AdMobConfig, AdMobStatus, AdUnitIds, BannerPosition, BannerSize,
    ConsentStatus, Error, Platform, ShowRewardedOptions, TrackingAuthorizationStatus,
};

#[test]
fn public_models_roundtrip_through_json() {
    // The JSON shapes produced and consumed by the TypeScript bindings.
    let config: AdMobConfig = serde_json::from_value(serde_json::json!({
        "appId": "ca-app-pub-1111111111~2222222222",
        "isTesting": true,
        "initializeOnStartup": false,
        "requestTrackingAuthorization": true,
        "automaticallyRequestConsent": true,
        "debug": false,
    }))
    .unwrap();
    assert_eq!(
        config.effective_app_id(Platform::Ios).as_deref(),
        Some("ca-app-pub-1111111111~2222222222")
    );

    let ids: AdUnitIds = serde_json::from_value(serde_json::json!({
        "banner": "ca-app-pub-3940256099942544/6300978111",
        "interstitial": "ca-app-pub-3940256099942544/1033173712",
        "rewarded": "ca-app-pub-3940256099942544/5224354917",
    }))
    .unwrap();
    assert!(ids.get(AdFormat::Banner).is_some());
}

#[test]
fn banner_options_use_documented_strings() {
    let position: BannerPosition = serde_json::from_value(serde_json::json!("bottom")).unwrap();
    assert_eq!(position, BannerPosition::Bottom);

    for (raw, expected) in [
        ("banner", BannerSize::Banner),
        ("largeBanner", BannerSize::LargeBanner),
        ("mediumRectangle", BannerSize::MediumRectangle),
        ("fullBanner", BannerSize::FullBanner),
        ("leaderboard", BannerSize::Leaderboard),
        ("adaptive", BannerSize::Adaptive),
    ] {
        let parsed: BannerSize = serde_json::from_value(serde_json::json!(raw)).unwrap();
        assert_eq!(parsed, expected);
        assert_eq!(
            serde_json::to_value(parsed).unwrap(),
            serde_json::json!(raw)
        );
    }

    // unknown strings are rejected instead of being forwarded to the SDK
    assert!(serde_json::from_value::<BannerSize>(serde_json::json!("huge")).is_err());
}

#[test]
fn rewarded_options_roundtrip_through_json() {
    let opts: ShowRewardedOptions = serde_json::from_value(serde_json::json!({
        "userId": "user-12345",
        "customData": "custom-payload"
    }))
    .unwrap();
    assert_eq!(opts.user_id.as_deref(), Some("user-12345"));
    assert_eq!(opts.custom_data.as_deref(), Some("custom-payload"));

    let empty: ShowRewardedOptions = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(empty.user_id, None);
    assert_eq!(empty.custom_data, None);
}

#[test]
fn status_report_unsupported_platforms() {
    let current = Platform::current();
    assert_eq!(
        Platform::current().supports_ads(),
        matches!(current, Platform::Android | Platform::Ios)
    );

    // desktop error shape carries the platform name
    let error = Error::UnsupportedPlatform("linux".to_string());
    let json = serde_json::to_value(&error).unwrap();
    assert_eq!(json["code"], "UNSUPPORTED_PLATFORM");
    assert!(json["message"].as_str().unwrap().contains("linux"));
}

#[test]
fn default_states_are_neutral() {
    assert_eq!(ConsentStatus::default(), ConsentStatus::Unknown);
    assert_eq!(
        TrackingAuthorizationStatus::default(),
        TrackingAuthorizationStatus::NotAvailable
    );
    assert_eq!(BannerPosition::default(), BannerPosition::Bottom);
    assert_eq!(BannerSize::default(), BannerSize::Adaptive);

    let status_json = serde_json::to_value(AdMobStatus {
        initialized: false,
        platform: Platform::current(),
        testing: false,
        consent_status: ConsentStatus::default(),
        tracking_status: TrackingAuthorizationStatus::default(),
        interstitial_ready: false,
        rewarded_ready: false,
        banner_visible: false,
    })
    .unwrap();
    assert_eq!(status_json["consentStatus"], "unknown");
    assert_eq!(status_json["trackingStatus"], "notAvailable");
}

#[test]
fn google_test_ids_are_official_and_stable() {
    assert_eq!(
        test_ids::ANDROID_BANNER,
        "ca-app-pub-3940256099942544/6300978111"
    );
    assert_eq!(
        test_ids::ANDROID_INTERSTITIAL,
        "ca-app-pub-3940256099942544/1033173712"
    );
    assert_eq!(
        test_ids::ANDROID_REWARDED,
        "ca-app-pub-3940256099942544/5224354917"
    );
    assert_eq!(
        test_ids::IOS_BANNER,
        "ca-app-pub-3940256099942544/2934735716"
    );
    assert_eq!(
        test_ids::IOS_INTERSTITIAL,
        "ca-app-pub-3940256099942544/441146891"
    );
    assert_eq!(
        test_ids::IOS_REWARDED,
        "ca-app-pub-3940256099942544/1717083536"
    );
}

#[test]
fn validation_helpers_are_public() {
    // re-exported so apps can pre-validate IDs before calling the plugin
    assert!(validate::app_id("ca-app-pub-3940256099942544~3347511713").is_ok());
    assert!(validate::ad_unit_id("ca-app-pub-3940256099942544/6300978111").is_ok());
    assert!(validate::app_id("nope").is_err());
    assert!(validate::ad_unit_id("nope").is_err());
}
