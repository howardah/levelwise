use crate::analysis::{measure_file, Analysis};
use std::path::Path;

#[tauri::command]
pub(crate) async fn analyze_audio(window: tauri::Window, path: String) -> Result<Analysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        measure_file(
            |percentage| {
                let _ = window.emit("analysis-progress", percentage);
            },
            Path::new(&path),
        )
    })
    .await
    .map_err(|error| format!("Analysis task failed: {error}"))?
}
