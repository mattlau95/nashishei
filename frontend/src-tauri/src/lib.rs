use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

struct MlSidecar(Mutex<Option<CommandChild>>);

#[tauri::command]
fn ml_base_url() -> &'static str {
    "http://127.0.0.1:8001"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![ml_base_url])
    .manage(MlSidecar(Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      match app
        .shell()
        .sidecar("nashishei-ml")
        .and_then(|cmd| cmd.spawn())
      {
        Ok((_, child)) => {
          *app.state::<MlSidecar>().0.lock().unwrap() = Some(child);
          log::info!("ML sidecar spawned");
        }
        Err(e) => log::error!("Failed to spawn ML sidecar: {e}"),
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
