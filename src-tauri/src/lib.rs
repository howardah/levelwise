mod analysis;
mod commands;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::analyze_audio])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
