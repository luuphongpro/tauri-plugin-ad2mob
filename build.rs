const COMMANDS: &[&str] = &[
    "initialize",
    "configure",
    "is_supported",
    "get_status",
    "request_consent",
    "get_consent_status",
    "request_tracking_authorization",
    "get_tracking_authorization_status",
    "load_interstitial",
    "show_interstitial",
    "is_interstitial_ready",
    "destroy_interstitial",
    "load_rewarded",
    "show_rewarded",
    "is_rewarded_ready",
    "destroy_rewarded",
    "show_banner",
    "hide_banner",
    "is_banner_visible",
    "set_banner_position",
    "destroy_banner",
    "destroy",
    // commands implemented by the Tauri mobile `Plugin` base classes, required by
    // `addPluginListener` on the guest side. Without an ACL entry these calls are
    // rejected by the runtime authority before they ever reach the native plugin.
    "register_listener",
    "remove_listener",
];

fn main() {
    #[cfg(target_os = "macos")]
    let ios_framework_slices = if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios")
        && std::env::var_os("DOCS_RS").is_none()
    {
        Some(ios_support::prepare_ios_frameworks())
    } else {
        None
    };

    let result = tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .try_build();

    // when building documentation for Android the plugin build result is always Err() and is irrelevant to the crate documentation build
    if !(cfg!(docsrs) && std::env::var("TARGET").unwrap().contains("android")) {
        result.unwrap();
    }

    #[cfg(target_os = "macos")]
    if let Some(slices) = ios_framework_slices {
        ios_support::link_ios_frameworks(&slices);
    }
}

#[cfg(target_os = "macos")]
mod ios_support {
    use std::{
        env, fs,
        path::{Path, PathBuf},
        process::Command,
    };

    pub fn prepare_ios_frameworks() -> Vec<PathBuf> {
        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        let pkg_name = env::var("CARGO_PKG_NAME").unwrap();
        let target = env::var("TARGET").unwrap_or_default();

        let slice = match target.as_str() {
            "aarch64-apple-ios" => "ios-arm64",
            "aarch64-apple-ios-sim" | "x86_64-apple-ios" => "ios-arm64_x86_64-simulator",
            other => panic!("unsupported iOS target: {other}"),
        };

        // Ensure `.tauri/tauri-api` exists before running `swift package resolve`.
        if let Ok(tauri_library_path) = env::var("DEP_TAURI_IOS_LIBRARY_PATH") {
            let tauri_dep_dir = manifest_dir.join(".tauri").join("tauri-api");
            let _ = fs::remove_dir_all(&tauri_dep_dir);
            copy_dir_filtered(
                Path::new(&tauri_library_path),
                &tauri_dep_dir,
                &[".build", "Package.resolved", "Tests"],
            )
            .expect("failed to copy tauri-api to .tauri/tauri-api");
        }

        let swift_build_dir = out_dir.join("swift-rs").join(&pkg_name);
        let artifacts_dir = swift_build_dir.join("artifacts");

        // Pre-populate deterministic slice paths so `swift package resolve` and
        // `swift build` evaluate `Package.swift` with identical environment state.
        let default_slices = vec![
            artifacts_dir
                .join("swift-package-manager-google-mobile-ads")
                .join("GoogleMobileAds")
                .join("GoogleMobileAds.xcframework")
                .join(slice),
            artifacts_dir
                .join("swift-package-manager-google-user-messaging-platform")
                .join("UserMessagingPlatform")
                .join("UserMessagingPlatform.xcframework")
                .join(slice),
        ];
        set_framework_paths_env(&default_slices);

        let sdk_root = env::var_os("SDKROOT");
        env::remove_var("SDKROOT");

        let status = Command::new("swift")
            .args([
                "package",
                "--build-path",
                swift_build_dir.to_str().unwrap(),
                "resolve",
            ])
            .current_dir(manifest_dir.join("ios"))
            .status()
            .expect("failed to run `swift package resolve` for ios plugin");

        if let Some(root) = sdk_root {
            env::set_var("SDKROOT", root);
        }

        assert!(
            status.success(),
            "`swift package resolve` failed for tauri-plugin-ad2mob iOS package"
        );

        let mut discovered = Vec::new();
        find_xcframework_slices(&artifacts_dir, slice, &mut discovered);
        if discovered.is_empty() {
            discovered = default_slices;
        } else {
            set_framework_paths_env(&discovered);
        }

        discovered
    }

    pub fn link_ios_frameworks(slice_dirs: &[PathBuf]) {
        let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
        let target = env::var("TARGET").unwrap_or_default();
        let arch = if target.starts_with("x86_64") {
            "x86_64"
        } else {
            "arm64"
        };

        println!("cargo:rustc-link-search=native={}", out_dir.display());

        for slice_dir in slice_dirs {
            if !slice_dir.exists() {
                continue;
            }
            println!("cargo:rustc-link-search=framework={}", slice_dir.display());

            if let Ok(entries) = fs::read_dir(slice_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("framework") {
                        continue;
                    }
                    let Some(fw_name) = path.file_stem().and_then(|s| s.to_str()) else {
                        continue;
                    };
                    let binary_path = path.join(fw_name);
                    if !binary_path.exists() {
                        continue;
                    }

                    link_framework_binary(&binary_path, &out_dir, fw_name, arch);
                }
            }
        }

        // System frameworks and libraries required by GoogleMobileAds & UserMessagingPlatform.
        for framework in [
            "AdSupport",
            "AppTrackingTransparency",
            "AudioToolbox",
            "AVFoundation",
            "CFNetwork",
            "CoreGraphics",
            "CoreMedia",
            "CoreTelephony",
            "CoreVideo",
            "JavaScriptCore",
            "MediaPlayer",
            "MessageUI",
            "MobileCoreServices",
            "QuartzCore",
            "Security",
            "StoreKit",
            "SystemConfiguration",
            "UIKit",
            "WebKit",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }

        for dylib in ["z", "sqlite3", "c++"] {
            println!("cargo:rustc-link-lib=dylib={dylib}");
        }
    }

    fn link_framework_binary(binary_path: &Path, out_dir: &Path, fw_name: &str, arch: &str) {
        let header = read_header_bytes(binary_path);

        // 1. If the binary has a Mach-O Universal (fat) header (0xCAFEBABE / 0xCAFEBABF),
        //    strip the fat container with `lipo -thin <arch>` even when it only holds 1 arch.
        let is_fat = matches!(
            header.get(0..4),
            Some(
                [0xCA, 0xFE, 0xBA, 0xBE]
                    | [0xBE, 0xBA, 0xFE, 0xCA]
                    | [0xCA, 0xFE, 0xBA, 0xBF]
                    | [0xBF, 0xBA, 0xFE, 0xCA]
            )
        );

        let thin_path = if is_fat {
            let thinned = out_dir.join(format!("{fw_name}.{arch}.thin"));
            let status = Command::new("lipo")
                .arg(binary_path)
                .arg("-thin")
                .arg(arch)
                .arg("-output")
                .arg(&thinned)
                .status()
                .expect("failed to execute `lipo -thin`");
            assert!(
                status.success(),
                "`lipo -thin {arch}` failed for {}",
                binary_path.display()
            );
            thinned
        } else {
            binary_path.to_path_buf()
        };

        let thin_header = read_header_bytes(&thin_path);
        let dest_archive = out_dir.join(format!("lib{fw_name}.a"));

        // 2. Inspect the thin binary format:
        //    - `!<arch>\n`: standard Unix static archive -> copy directly to `lib<fw_name>.a`.
        //    - `0xFEEDFACF` (`MH_MAGIC_64`):
        //      - filetype 1 (`MH_OBJECT`, single-object prelink `ld -r`) -> wrap in `ar crs lib<fw_name>.a <fw_name>.o`.
        //      - filetype 6 (`MH_DYLIB`, dynamic framework) -> link via `framework=<fw_name>`.
        if thin_header.starts_with(b"!<arch>\n") {
            if thin_path != dest_archive {
                fs::copy(&thin_path, &dest_archive).expect("failed to copy thin static archive");
            }
            println!("cargo:rustc-link-lib=static:+whole-archive={fw_name}");
        } else if thin_header.get(0..4) == Some(&[0xCF, 0xFA, 0xED, 0xFE]) && thin_header.len() >= 16 {
            let filetype = u32::from_le_bytes([
                thin_header[12],
                thin_header[13],
                thin_header[14],
                thin_header[15],
            ]);
            if filetype == 1 {
                // MH_OBJECT: single relocatable object file; pack into a standard `!<arch>\n` archive.
                let obj_path = out_dir.join(format!("{fw_name}.o"));
                fs::copy(&thin_path, &obj_path).expect("failed to copy MH_OBJECT to .o");
                let _ = fs::remove_file(&dest_archive);
                let status = Command::new("ar")
                    .arg("crs")
                    .arg(&dest_archive)
                    .arg(&obj_path)
                    .status()
                    .expect("failed to run `ar crs`");
                assert!(
                    status.success(),
                    "`ar crs` failed for {}",
                    dest_archive.display()
                );
                println!("cargo:rustc-link-lib=static:+whole-archive={fw_name}");
            } else {
                // MH_DYLIB or other Mach-O image: link as framework.
                println!("cargo:rustc-link-lib=framework={fw_name}");
            }
        } else {
            println!("cargo:rustc-link-lib=framework={fw_name}");
        }
    }

    fn read_header_bytes(path: &Path) -> Vec<u8> {
        use std::io::Read;
        let mut file = fs::File::open(path)
            .unwrap_or_else(|e| panic!("failed to open {}: {e}", path.display()));
        let mut buf = vec![0u8; 16];
        let n = file.read(&mut buf).unwrap_or(0);
        buf.truncate(n);
        buf
    }

    fn set_framework_paths_env(paths: &[PathBuf]) {
        let joined = paths
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(":");
        env::set_var("AD2MOB_IOS_FRAMEWORK_PATHS", joined);
    }

    fn find_xcframework_slices(dir: &Path, slice: &str, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) == Some("xcframework") {
                let candidate = path.join(slice);
                if candidate.is_dir() {
                    out.push(candidate);
                }
            } else {
                find_xcframework_slices(&path, slice, out);
            }
        }
    }

    fn copy_dir_filtered(src: &Path, dst: &Path, ignore: &[&str]) -> std::io::Result<()> {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if ignore.iter().any(|ig| *ig == name_str) {
                continue;
            }
            let src_path = entry.path();
            let dst_path = dst.join(&name);
            if entry.file_type()?.is_dir() {
                copy_dir_filtered(&src_path, &dst_path, ignore)?;
            } else {
                fs::copy(&src_path, &dst_path)?;
            }
        }
        Ok(())
    }
}
