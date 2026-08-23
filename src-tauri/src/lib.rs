

mod bepinex;
mod diag;
mod inject;
mod metadata;
mod receiver;
mod router;
mod scanner;

use router::{InjectRequest, RouterProbe};
use scanner::MonoProcess;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

#[tauri::command]
async fn list_mono_processes() -> Vec<MonoProcess> {
    tauri::async_runtime::spawn_blocking(scanner::scan)
        .await
        .unwrap_or_default()
}

#[tauri::command]
fn list_entry_points(dll_path: String) -> Result<Vec<metadata::EntryPoint>, String> {
    metadata::list_entry_points(&dll_path)
}

#[tauri::command]
fn assembly_references(dll_path: String) -> Result<Vec<String>, String> {
    metadata::assembly_references(&dll_path)
}

#[tauri::command]
async fn router_probe(pid: u32) -> RouterProbe {
    tauri::async_runtime::spawn_blocking(move || router::probe(pid))
        .await
        .unwrap_or_else(|_| RouterProbe {
            bepinex_live: false,
            receiver: None,
            recommended: "direct".into(),
            reason: "probe failed".into(),
        })
}

#[tauri::command]
async fn receiver_ping() -> Result<Option<receiver::ReceiverHello>, String> {
    tauri::async_runtime::spawn_blocking(|| receiver::ping(1500))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn receiver_install(pid: u32, game_dir: String) -> Result<String, String> {
    let dest = bepinex::install_receiver(pid, &game_dir)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
fn receiver_install_target(pid: u32, game_dir: String) -> Result<String, String> {
    let dest = bepinex::receiver_target_path(pid, &game_dir)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
async fn inject(app: AppHandle, request: InjectRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || router::run(&app, request))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_injection(_pid: u32) -> Result<(), String> {

    Ok(())
}

#[tauri::command]
fn open_player_log(game_dir: Option<String>) -> Result<String, String> {
    diag::open_player_log(game_dir)
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    diag::reveal_path(&path)
}

#[tauri::command]
fn save_text(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write {path}: {e}"))
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

fn data_dir() -> Result<std::path::PathBuf, String> {
    let base = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
    let dir = std::path::PathBuf::from(base).join("ZyMono");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    Ok(dir)
}

#[tauri::command]
fn profiles_load() -> Result<String, String> {
    let p = data_dir()?.join("profiles.json");
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(s),
        Err(_) => Ok("[]".into()),
    }
}

#[tauri::command]
fn profiles_save(json: String) -> Result<(), String> {
    let p = data_dir()?.join("profiles.json");
    std::fs::write(&p, json).map_err(|e| format!("save profiles: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {

            let show = MenuItem::with_id(app, "show", "Show ZyMono", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit ZyMono", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("ZyMono — Mono injector")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_mono_processes,
            list_entry_points,
            assembly_references,
            router_probe,
            receiver_ping,
            receiver_install,
            receiver_install_target,
            inject,
            cancel_injection,
            open_player_log,
            reveal_path,
            save_text,
            read_text,
            profiles_load,
            profiles_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ZyMono");
}
