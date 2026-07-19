fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "save_library_export",
            "restart_prax",
            "hide_capture_window",
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to build Prax desktop metadata");
}
