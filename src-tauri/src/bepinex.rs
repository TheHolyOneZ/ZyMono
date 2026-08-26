

use crate::scanner::list_modules;
use std::path::{Path, PathBuf};

pub fn detect_loader(pid: u32) -> Option<String> {
    let mods = list_modules(pid);

    if mods.iter().any(|m| m.name.contains("melonloader")) {
        return Some("MelonLoader".into());
    }
    if mods.iter().any(|m| m.name.contains("bepinex") || m.name.contains("doorstop")) {
        return Some("BepInEx".into());
    }

    for m in &mods {
        if is_system_module_path(&m.path) {
            continue;
        }
        if m.name == "version.dll" {
            return Some("MelonLoader".into());
        }
        if m.name == "winhttp.dll" {
            return Some("BepInEx".into());
        }
    }

    if mapped_files_contain(pid, &["melonloader"]) {
        return Some("MelonLoader".into());
    }
    if mapped_files_contain(pid, &["bepinex"]) {
        return Some("BepInEx".into());
    }
    None
}

fn is_system_module_path(path: &str) -> bool {
    let p = path.to_lowercase();
    p.contains("\\windows\\system32") || p.contains("\\windows\\syswow64") || p.contains("\\windows\\winsxs")
}

const RECEIVER_DLL: &str = "ZyMonoReceiver.dll";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiverVariant {

    Classic,

    BepInExIL2CPP,

    MelonLoader,
}

impl ReceiverVariant {

    pub fn dll_name(self) -> &'static str {
        match self {
            Self::Classic => "ZyMonoReceiver.dll",
            Self::BepInExIL2CPP => "ZyMonoReceiverIL2CPP.dll",
            Self::MelonLoader => "ZyMonoMelonReceiver.dll",
        }
    }

    pub fn install_subdir(self) -> &'static [&'static str] {
        match self {
            Self::Classic | Self::BepInExIL2CPP => &["BepInEx", "plugins"],
            Self::MelonLoader => &["Mods"],
        }
    }

    fn live_root_name(self) -> &'static str {
        match self {
            Self::Classic | Self::BepInExIL2CPP => "BepInEx",
            Self::MelonLoader => "MelonLoader",
        }
    }

    fn dev_output_subdir(self) -> &'static str {
        match self {
            Self::Classic => "ZyMono.Receiver/bin/Release",
            Self::BepInExIL2CPP => "ZyMono.Receiver.IL2CPP/bin/Release",
            Self::MelonLoader => "ZyMono.MelonReceiver/bin/Release",
        }
    }
}

pub fn pick_variant(loader: Option<&str>, engine: &str) -> ReceiverVariant {
    match (loader, engine) {
        (Some("MelonLoader"), _) => ReceiverVariant::MelonLoader,
        (Some("BepInEx"), "IL2CPP") => ReceiverVariant::BepInExIL2CPP,
        _ => ReceiverVariant::Classic,
    }
}

pub fn variant_for_pid(pid: u32) -> ReceiverVariant {
    let loader = detect_loader(pid);
    let engine = crate::scanner::scan()
        .into_iter()
        .find(|p| p.pid == pid)
        .map(|p| p.engine)
        .unwrap_or_default();
    pick_variant(loader.as_deref(), &engine)
}

pub struct ReceiverInfo {
    #[allow(dead_code)]
    pub path: PathBuf,
    pub plugins_dir: PathBuf,
}

pub fn discover_receiver_for(game_dir: &str, exe_name: &str, variant: ReceiverVariant) -> Option<ReceiverInfo> {
    let game = Path::new(game_dir);
    let mut plugins = game.to_path_buf();
    for seg in variant.install_subdir() {
        plugins = plugins.join(seg);
    }

    if plugins.is_dir() {
        if let Some(found) = search_dir(&plugins, variant.dll_name()) {
            return Some(ReceiverInfo {
                path: found,
                plugins_dir: plugins,
            });
        }
    }

    if variant == ReceiverVariant::Classic {
        let bases = mod_manager_bases();
        let exe_stem = exe_name.trim_end_matches(".exe").to_lowercase();
        for base in bases {
            if let Some(info) = search_profiles(&base, &exe_stem) {
                return Some(info);
            }
        }
    }

    Some(ReceiverInfo {
        path: plugins.join(variant.dll_name()),
        plugins_dir: plugins,
    })
}

fn mod_manager_bases() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        v.push(PathBuf::from(&local).join("Thunderstore Mod Manager").join("DataFolder"));
    }
    if let Ok(roaming) = std::env::var("APPDATA") {
        v.push(PathBuf::from(&roaming).join("Thunderstore Mod Manager").join("DataFolder"));
        v.push(PathBuf::from(&roaming).join("r2modmanPlus-local").join("profiles"));
    }
    v
}

fn search_profiles(base: &Path, exe_stem: &str) -> Option<ReceiverInfo> {
    let read = std::fs::read_dir(base).ok()?;
    for game_folder in read.flatten() {
        let gp = game_folder.path();
        if !gp.is_dir() {
            continue;
        }
        let folder_name = gp.file_name()?.to_str()?.to_lowercase();
        if !folder_name.contains(exe_stem) {
            continue;
        }
        let profiles = gp.join("profiles");
        let scan_root = if profiles.is_dir() { profiles } else { gp.clone() };
        for prof in std::fs::read_dir(&scan_root).ok()?.flatten() {
            let plugins = prof.path().join("BepInEx").join("plugins");
            if plugins.is_dir() {
                if let Some(found) = search_dir(&plugins, RECEIVER_DLL) {
                    return Some(ReceiverInfo {
                        path: found,
                        plugins_dir: plugins,
                    });
                }
            }
        }
    }
    None
}

fn search_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.is_file() {
        return Some(direct);
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = search_dir(&p, name) {
                return Some(found);
            }
        }
    }
    None
}

pub fn bundled_receiver_dll_for(variant: ReceiverVariant) -> Option<PathBuf> {

    let env_key = match variant {
        ReceiverVariant::Classic => "ZYMONO_RECEIVER_DLL",
        ReceiverVariant::BepInExIL2CPP => "ZYMONO_RECEIVER_IL2CPP_DLL",
        ReceiverVariant::MelonLoader => "ZYMONO_MELON_RECEIVER_DLL",
    };
    if let Ok(p) = std::env::var(env_key) {
        let pb = PathBuf::from(p);
        if pb.is_file() {
            return Some(pb);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    let dll = variant.dll_name();

    for cand in [
        exe_dir.join(dll),
        exe_dir.join("resources").join(dll),
    ] {
        if cand.is_file() {
            return Some(cand);
        }
    }

    let dev = exe_dir
        .join("../../../")
        .join(variant.dev_output_subdir())
        .join(dll);
    if dev.is_file() {
        return Some(dev);
    }
    None
}

pub fn resolve_install_dir(pid: u32, game_dir: &str, variant: ReceiverVariant) -> Result<PathBuf, String> {
    if let Some(live) = live_install_dir(pid, variant) {
        return Ok(live);
    }
    if let Some(info) = discover_receiver_for(game_dir, "", variant) {
        return Ok(info.plugins_dir);
    }
    if game_dir.is_empty() {
        return Err(format!(
            "no live {} found and no game folder to fall back to",
            variant.live_root_name()
        ));
    }
    let mut p = PathBuf::from(game_dir);
    for seg in variant.install_subdir() {
        p = p.join(seg);
    }
    Ok(p)
}

pub fn receiver_target_path(pid: u32, game_dir: &str) -> Result<PathBuf, String> {
    let variant = variant_for_pid(pid);
    Ok(resolve_install_dir(pid, game_dir, variant)?.join(variant.dll_name()))
}

pub fn install_receiver(pid: u32, game_dir: &str) -> Result<PathBuf, String> {
    let variant = variant_for_pid(pid);
    let src = bundled_receiver_dll_for(variant).ok_or_else(|| {
        format!(
            "bundled receiver DLL not found: {} — build the {} project first",
            variant.dll_name(),
            match variant {
                ReceiverVariant::Classic => "ZyMono.Receiver",
                ReceiverVariant::BepInExIL2CPP => "ZyMono.Receiver.IL2CPP",
                ReceiverVariant::MelonLoader => "ZyMono.MelonReceiver",
            }
        )
    })?;
    let plugins = resolve_install_dir(pid, game_dir, variant)?;
    std::fs::create_dir_all(&plugins)
        .map_err(|e| format!("create {}: {e}", plugins.display()))?;
    let dest = plugins.join(variant.dll_name());
    std::fs::copy(&src, &dest).map_err(|e| format!("copy receiver: {e}"))?;
    Ok(dest)
}

#[cfg(windows)]
pub fn live_install_dir(pid: u32, variant: ReceiverVariant) -> Option<PathBuf> {
    let root = variant.live_root_name();
    let device_path = first_mapped_containing(pid, &root.to_lowercase())?;
    let dos = device_to_dos(&device_path)?;
    let p = PathBuf::from(&dos);
    for anc in p.ancestors() {
        if anc
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case(root))
        {

            return Some(match variant {
                ReceiverVariant::Classic | ReceiverVariant::BepInExIL2CPP => anc.join("plugins"),
                ReceiverVariant::MelonLoader => anc.parent()?.join("Mods"),
            });
        }
    }
    None
}

#[cfg(not(windows))]
pub fn live_install_dir(_pid: u32, _variant: ReceiverVariant) -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn first_mapped_containing(pid: u32, needle_lower: &str) -> Option<String> {
    use std::ffi::c_void;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Memory as vm;
    use windows::Win32::System::ProcessStatus as ps;
    use windows::Win32::System::Threading as th;

    unsafe {
        let handle = th::OpenProcess(
            th::PROCESS_QUERY_INFORMATION | th::PROCESS_VM_READ,
            false,
            pid,
        )
        .ok()?;

        let mut result = None;
        let mut addr: usize = 0;
        let mbi_size = std::mem::size_of::<vm::MEMORY_BASIC_INFORMATION>();
        for _ in 0..300_000 {
            let mut mbi = vm::MEMORY_BASIC_INFORMATION::default();
            let ret = vm::VirtualQueryEx(handle, Some(addr as *const c_void), &mut mbi, mbi_size);
            if ret == 0 {
                break;
            }
            if mbi.State == vm::MEM_COMMIT {
                let mut buf = [0u16; 260];
                let len = ps::GetMappedFileNameW(handle, mbi.BaseAddress, &mut buf) as usize;
                if len > 0 {
                    let name = String::from_utf16_lossy(&buf[..len]);
                    if name.to_lowercase().contains(needle_lower) {
                        result = Some(name);
                        break;
                    }
                }
            }
            let region = mbi.RegionSize.max(0x1000);
            match addr.checked_add(region) {
                Some(next) if next > addr => addr = next,
                _ => break,
            }
        }
        let _ = CloseHandle(handle);
        result
    }
}

#[cfg(windows)]
fn device_to_dos(device_path: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetLogicalDriveStringsW, QueryDosDeviceW};

    unsafe {
        let mut drives = [0u16; 512];
        let n = GetLogicalDriveStringsW(Some(&mut drives)) as usize;
        if n == 0 {
            return None;
        }
        let list = String::from_utf16_lossy(&drives[..n]);
        for drive in list.split('\0').filter(|d| !d.is_empty()) {
            let letter = drive.trim_end_matches('\\');
            let wide: Vec<u16> = letter.encode_utf16().chain(std::iter::once(0)).collect();
            let mut target = [0u16; 512];
            let tlen = QueryDosDeviceW(PCWSTR(wide.as_ptr()), Some(&mut target));
            if tlen == 0 {
                continue;
            }
            let dev = String::from_utf16_lossy(&target);
            let dev = dev.split('\0').next().unwrap_or("");
            if !dev.is_empty() && device_path.starts_with(dev) {
                return Some(format!("{}{}", letter, &device_path[dev.len()..]));
            }
        }
        None
    }
}

#[cfg(windows)]
fn mapped_files_contain(pid: u32, needles: &[&str]) -> bool {
    use std::ffi::c_void;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Memory as vm;
    use windows::Win32::System::ProcessStatus as ps;
    use windows::Win32::System::Threading as th;

    unsafe {
        let handle = match th::OpenProcess(
            th::PROCESS_QUERY_INFORMATION | th::PROCESS_VM_READ,
            false,
            pid,
        ) {
            Ok(h) => h,
            Err(_) => return false,
        };

        let mut found = false;
        let mut addr: usize = 0;
        let mbi_size = std::mem::size_of::<vm::MEMORY_BASIC_INFORMATION>();
        for _ in 0..300_000 {
            let mut mbi = vm::MEMORY_BASIC_INFORMATION::default();
            let ret = vm::VirtualQueryEx(handle, Some(addr as *const c_void), &mut mbi, mbi_size);
            if ret == 0 {
                break;
            }
            if mbi.State == vm::MEM_COMMIT {
                let mut buf = [0u16; 260];
                let len = ps::GetMappedFileNameW(handle, mbi.BaseAddress, &mut buf) as usize;
                if len > 0 {
                    let name = String::from_utf16_lossy(&buf[..len]).to_lowercase();
                    if needles.iter().any(|n| name.contains(n)) {
                        found = true;
                        break;
                    }
                }
            }
            let region = mbi.RegionSize.max(0x1000);
            match addr.checked_add(region) {
                Some(next) if next > addr => addr = next,
                _ => break,
            }
        }
        let _ = CloseHandle(handle);
        found
    }
}

#[cfg(not(windows))]
fn mapped_files_contain(_pid: u32, _needles: &[&str]) -> bool {
    false
}
