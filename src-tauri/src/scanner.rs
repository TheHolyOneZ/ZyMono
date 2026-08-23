

use serde::Serialize;
use std::path::{Path, PathBuf};

#[cfg(windows)]
use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
#[cfg(windows)]
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Process32FirstW, Process32NextW,
    MODULEENTRY32W, PROCESSENTRY32W, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
};
#[cfg(windows)]
use windows::Win32::System::Threading::{
    IsWow64Process2, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};

#[derive(Debug, Clone, Serialize)]
pub struct MonoProcess {
    pub pid: u32,
    pub name: String,
    pub cmdline: String,
    pub flavor: String,
    pub module_path: String,
    pub data_dir: Option<String>,
    pub game_dir: Option<String>,
    pub exe_path: Option<String>,
    pub thread_count: u32,
    pub arch: String,
    pub suspect: bool,
    pub engine: String,
    pub injectable: bool,
    pub duplicate: bool,
    pub bepinex_live: bool,
    pub app_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ModuleInfo {
    pub name: String,
    pub path: String,
}

fn wstr_to_string(w: &[u16]) -> String {
    let end = w.iter().position(|&c| c == 0).unwrap_or(w.len());
    String::from_utf16_lossy(&w[..end])
}

#[cfg(windows)]
pub fn list_modules(pid: u32) -> Vec<ModuleInfo> {
    let mut out = Vec::new();
    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) {
            Ok(h) => h,
            Err(_) => return out,
        };
        let mut me = MODULEENTRY32W {
            dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
            ..Default::default()
        };
        if Module32FirstW(snap, &mut me).is_ok() {
            loop {
                let path = wstr_to_string(&me.szExePath);
                let name = wstr_to_string(&me.szModule).to_lowercase();
                out.push(ModuleInfo { name, path });
                if Module32NextW(snap, &mut me).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

#[cfg(not(windows))]
pub fn list_modules(_pid: u32) -> Vec<ModuleInfo> {
    Vec::new()
}

fn mono_flavor(module_base: &str) -> Option<&'static str> {
    let m = module_base;
    if m.contains("mono-2.0-bdwgc") || m.contains("monobdwgc") {
        Some("Mono (bdwgc)")
    } else if m.contains("mono-2.0-sgen") || m.contains("monosgen") {
        Some("Mono (sgen)")
    } else if m == "mono.dll" || m == "mono-2.0.dll" || m.starts_with("mono-2.0") || m == "mono-native.dll" {
        Some("Mono")
    } else {
        None
    }
}

fn is_il2cpp(module_base: &str) -> bool {
    module_base == "gameassembly.dll" || module_base.contains("il2cpp")
}

fn bepinex_live_from_modules(mods: &[ModuleInfo]) -> bool {
    for m in mods {
        let n = &m.name;
        if n.contains("bepinex") || n.contains("doorstop") || n.contains("il2cppinterop") {
            return true;
        }
        if (n == "winhttp.dll" || n == "version.dll") && !is_system_path(&m.path) {
            return true;
        }
    }
    false
}

fn is_system_path(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("\\windows\\system32") || p.contains("\\windows\\syswow64") || p.contains("\\windows\\winsxs")
}

#[cfg(windows)]
fn process_arch(handle: HANDLE) -> &'static str {
    unsafe {
        let mut process_machine = windows::Win32::System::SystemInformation::IMAGE_FILE_MACHINE(0);
        let mut native_machine = windows::Win32::System::SystemInformation::IMAGE_FILE_MACHINE(0);
        if IsWow64Process2(handle, &mut process_machine, Some(&mut native_machine)).is_ok() {

            if process_machine.0 == 0x014c {
                return "x86";
            }
        }
        "x64"
    }
}

#[cfg(windows)]
fn full_image_path(handle: HANDLE) -> Option<String> {
    unsafe {
        let mut buf = [0u16; (MAX_PATH as usize) * 2];
        let mut size = buf.len() as u32;
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut size,
        )
        .ok()?;
        Some(wstr_to_string(&buf[..size as usize]))
    }
}

fn find_data_dir(exe: &Path) -> Option<PathBuf> {
    let dir = exe.parent()?;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                if name.ends_with("_Data") {
                    return Some(p);
                }
            }
        }
    }
    None
}

fn read_steam_appid(game_dir: &Path) -> Option<String> {
    let p = game_dir.join("steam_appid.txt");
    let s = std::fs::read_to_string(p).ok()?;
    let id = s.trim().to_string();
    if id.is_empty() {
        None
    } else {
        Some(id)
    }
}

#[cfg(windows)]
fn inspect(pid: u32, exe_name: &str, thread_count: u32) -> Option<MonoProcess> {
    if pid == std::process::id() {
        return None;
    }
    let mods = list_modules(pid);
    if mods.is_empty() {
        return None;
    }

    let mut engine = None;
    let mut flavor = String::new();
    let mut module_path = String::new();

    for m in &mods {
        if let Some(fl) = mono_flavor(&m.name) {
            engine = Some("Mono");
            flavor = fl.to_string();
            module_path = m.path.clone();
            break;
        }
    }
    if engine.is_none() {
        for m in &mods {
            if is_il2cpp(&m.name) {
                engine = Some("IL2CPP");
                flavor = "IL2CPP".to_string();
                module_path = m.path.clone();
                break;
            }
        }
    }
    let engine = engine?;

    let (arch, exe_path) = unsafe {
        match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => {
                let a = process_arch(h);
                let p = full_image_path(h);
                let _ = CloseHandle(h);
                (a.to_string(), p)
            }
            Err(_) => ("x64".to_string(), None),
        }
    };

    let exe_pathbuf = exe_path.as_ref().map(PathBuf::from);
    let data_dir = exe_pathbuf.as_deref().and_then(find_data_dir);
    let game_dir = exe_pathbuf
        .as_deref()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));
    let app_id = game_dir.as_deref().and_then(read_steam_appid);

    let injectable = engine == "Mono";

    Some(MonoProcess {
        pid,
        name: exe_name.to_string(),
        cmdline: String::new(),
        flavor,
        module_path,
        data_dir: data_dir.map(|p| p.to_string_lossy().into_owned()),
        game_dir: game_dir.map(|p| p.to_string_lossy().into_owned()),
        exe_path,
        thread_count,
        arch,
        suspect: false,
        engine: engine.to_string(),
        injectable,
        duplicate: false,
        bepinex_live: bepinex_live_from_modules(&mods),
        app_id,
    })
}

#[cfg(windows)]
pub fn scan() -> Vec<MonoProcess> {
    let mut out: Vec<MonoProcess> = Vec::new();
    unsafe {
        let snap = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return out,
        };
        let mut pe = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snap, &mut pe).is_ok() {
            loop {
                let pid = pe.th32ProcessID;
                let name = wstr_to_string(&pe.szExeFile);
                let threads = pe.cntThreads;
                if let Some(mp) = inspect(pid, &name, threads) {
                    out.push(mp);
                }
                if Process32NextW(snap, &mut pe).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }

    if std::env::var("ZYMONO_FAKE_TARGET").is_ok() {
        out.push(fake_target());
    }

    mark_duplicates(&mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

fn fake_target() -> MonoProcess {
    MonoProcess {
        pid: 424242,
        name: "SampleUnityGame.exe".into(),
        cmdline: String::new(),
        flavor: "Mono (bdwgc)".into(),
        module_path: "C:/Games/Sample/mono-2.0-bdwgc.dll".into(),
        data_dir: Some("C:/Games/Sample/SampleUnityGame_Data".into()),
        game_dir: Some("C:/Games/Sample".into()),
        exe_path: Some("C:/Games/Sample/SampleUnityGame.exe".into()),
        thread_count: 24,
        arch: "x64".into(),
        suspect: false,
        engine: "Mono".into(),
        injectable: true,
        duplicate: false,
        bepinex_live: false,
        app_id: None,
    }
}

#[cfg(not(windows))]
pub fn scan() -> Vec<MonoProcess> {
    Vec::new()
}

fn mark_duplicates(list: &mut [MonoProcess]) {
    let mut order: Vec<usize> = (0..list.len()).collect();
    order.sort_by(|&a, &b| list[b].thread_count.cmp(&list[a].thread_count));
    let mut seen: Vec<String> = Vec::new();
    for &i in &order {
        let key = list[i]
            .exe_path
            .clone()
            .unwrap_or_else(|| format!("pid:{}", list[i].pid));
        if seen.contains(&key) {
            list[i].duplicate = true;
        } else {
            seen.push(key);
        }
    }
}
