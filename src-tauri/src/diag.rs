

use std::path::{Path, PathBuf};

fn locallow() -> Option<PathBuf> {
    let profile = std::env::var("USERPROFILE").ok()?;
    let p = PathBuf::from(profile).join("AppData").join("LocalLow");
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

fn newest_player_log() -> Option<PathBuf> {
    let root = locallow()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for company in std::fs::read_dir(&root).ok()?.flatten() {
        let cp = company.path();
        if !cp.is_dir() {
            continue;
        }
        for game in std::fs::read_dir(&cp).ok()?.flatten() {
            let log = game.path().join("Player.log");
            if let Ok(meta) = std::fs::metadata(&log) {
                if let Ok(modified) = meta.modified() {
                    if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
                        best = Some((modified, log));
                    }
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

pub fn open_player_log(_game_dir: Option<String>) -> Result<String, String> {
    let log = newest_player_log().ok_or("no Unity Player.log found under AppData\\LocalLow")?;
    open_path(&log)?;
    Ok(log.to_string_lossy().into_owned())
}

pub fn reveal_path(path: &str) -> Result<(), String> {

    open_path(Path::new(path))
}

#[cfg(windows)]
fn open_path(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(path.as_os_str())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open {}: {e}", path.display()))
}

#[cfg(not(windows))]
fn open_path(_path: &Path) -> Result<(), String> {
    Err("unsupported on this platform".into())
}
