

use super::native::{looks_managed, pe_machine};
use std::path::{Path, PathBuf};

pub struct ProxyPlan {
    pub proxy_name: String,
    pub install_path: PathBuf,
    pub target_mod_path: PathBuf,
    pub arch: String,
    pub existing_will_be_backed_up: bool,
}

const BACKUP_SUFFIX: &str = ".zymono-backup";

const WINHTTP_EXPORTS: &[&str] = &[
    "WinHttpAddRequestHeaders",
    "WinHttpCloseHandle",
    "WinHttpConnect",
    "WinHttpCrackUrl",
    "WinHttpOpen",
    "WinHttpOpenRequest",
    "WinHttpQueryDataAvailable",
    "WinHttpQueryHeaders",
    "WinHttpReadData",
    "WinHttpReceiveResponse",
    "WinHttpSendRequest",
    "WinHttpSetOption",
    "WinHttpSetTimeouts",
];

const VERSION_EXPORTS: &[&str] = &[
    "GetFileVersionInfoA",
    "GetFileVersionInfoSizeA",
    "GetFileVersionInfoSizeW",
    "GetFileVersionInfoW",
    "VerFindFileA",
    "VerFindFileW",
    "VerInstallFileA",
    "VerInstallFileW",
    "VerLanguageNameA",
    "VerLanguageNameW",
    "VerQueryValueA",
    "VerQueryValueW",
];

fn exports_for(proxy_stem: &str) -> Result<(&'static str, &'static [&'static str]), String> {
    match proxy_stem {
        "winhttp" => Ok(("winhttp", WINHTTP_EXPORTS)),
        "version" => Ok(("version", VERSION_EXPORTS)),
        other => Err(format!(
            "unsupported proxy name \"{other}\" — this installer only knows winhttp and version"
        )),
    }
}

fn find_game_exe(game_dir: &Path) -> Result<PathBuf, String> {
    let read = std::fs::read_dir(game_dir)
        .map_err(|e| format!("read {}: {e}", game_dir.display()))?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    for entry in read.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let is_exe = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        if !is_exe {
            continue;
        }
        candidates.push(p);
    }
    if candidates.is_empty() {
        return Err(format!(
            "no .exe found in {} — is this really a game folder?",
            game_dir.display()
        ));
    }

    if let Some(main) = candidates.iter().find(|p| {
        let n = p
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        !n.contains("unitycrash") && !n.contains("crashhandler") && !n.contains("unins")
    }) {
        return Ok(main.clone());
    }
    Ok(candidates.into_iter().next().unwrap())
}

pub fn plan(
    game_dir: &Path,
    mod_dll_path: &Path,
    prefer: Option<&str>,
) -> Result<ProxyPlan, String> {
    if !game_dir.is_dir() {
        return Err(format!(
            "game folder doesn't exist: {}",
            game_dir.display()
        ));
    }
    let game_exe = find_game_exe(game_dir)?;

    if !mod_dll_path.is_file() {
        return Err(format!(
            "mod DLL doesn't exist: {}",
            mod_dll_path.display()
        ));
    }
    let mod_bytes = std::fs::read(mod_dll_path)
        .map_err(|e| format!("read {}: {e}", mod_dll_path.display()))?;
    let (_m, mod_arch) = pe_machine(&mod_bytes)?;
    if looks_managed(&mod_bytes) {
        return Err(
            "this looks like a .NET/managed assembly, not a native DLL. The proxy stub calls LoadLibraryW, which won't run any managed entry point — build your mod as a native C/C++/Rust DLL, or install BepInEx and use the managed route."
                .into(),
        );
    }

    let exe_bytes = std::fs::read(&game_exe)
        .map_err(|e| format!("read {}: {e}", game_exe.display()))?;
    let (_gm, game_arch) = pe_machine(&exe_bytes)?;

    if game_arch != mod_arch {
        return Err(format!(
            "architecture mismatch — the game ({}) is {game_arch} but the mod DLL is {mod_arch}. Build your native mod for {game_arch}."
        , game_exe.file_name().and_then(|s| s.to_str()).unwrap_or("game.exe")));
    }
    if game_arch == "unknown" {
        return Err("couldn't recognise the game exe's PE machine field".into());
    }
    if game_arch != "x64" {
        return Err(format!(
            "this game is {game_arch}. The proxy-DLL installer only emits an x64 stub right now — for x86 games, use the runtime LoadLibrary or Manual Map route via the process picker instead."
        ));
    }

    let winhttp_path = game_dir.join("winhttp.dll");
    let version_path = game_dir.join("version.dll");
    let winhttp_present = winhttp_path.exists();
    let version_present = version_path.exists();

    let proxy_stem: &str = match prefer.map(|s| s.trim().to_lowercase()).as_deref() {
        Some("winhttp") | Some("winhttp.dll") => "winhttp",
        Some("version") | Some("version.dll") => "version",
        Some(other) if !other.is_empty() => {
            return Err(format!(
                "unknown proxy preference \"{other}\" — pass \"winhttp\" or \"version\""
            ));
        }
        _ => {
            if winhttp_present && version_present {
                return Err(
                    "both winhttp.dll and version.dll are already present in the game folder — this game already has a proxy-based mod loader installed (BepInEx? ReShade?). Uninstall it first, or remove one of the files by hand."
                        .into(),
                );
            } else if winhttp_present {
                "version"
            } else {
                "winhttp"
            }
        }
    };

    let proxy_name = format!("{proxy_stem}.dll");
    let install_path = game_dir.join(&proxy_name);
    let existing_will_be_backed_up = install_path.exists();

    Ok(ProxyPlan {
        proxy_name,
        install_path,
        target_mod_path: mod_dll_path.to_path_buf(),
        arch: game_arch.to_string(),
        existing_will_be_backed_up,
    })
}

pub fn install(plan: &ProxyPlan, log: &dyn Fn(&str)) -> Result<(), String> {
    let install_path = &plan.install_path;
    let backup_path = {
        let mut s = install_path.as_os_str().to_owned();
        s.push(BACKUP_SUFFIX);
        PathBuf::from(s)
    };

    if install_path.exists() {
        if backup_path.exists() {
            return Err(format!(
                "a previous backup already exists at {} — remove it first so we don't overwrite it (it may be the game's original file)",
                backup_path.display()
            ));
        }
        log(&format!(
            "→ backing up existing {} to {}",
            plan.proxy_name,
            backup_path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("<backup>")
        ));
        std::fs::rename(install_path, &backup_path).map_err(|e| {
            format!(
                "back up {}: {e}",
                install_path.display()
            )
        })?;
    }

    let stem = install_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "internal error: proxy name has no stem".to_string())?;

    let mod_abs = std::fs::canonicalize(&plan.target_mod_path)
        .map_err(|e| format!("resolve mod path: {e}"))?;

    let mod_abs_str = {
        let s = mod_abs.to_string_lossy().to_string();
        s.strip_prefix(r"\\?\").map(|s| s.to_string()).unwrap_or(s)
    };
    log(&format!("→ generating x64 stub, mod path = {mod_abs_str}"));

    let bytes = stub_bytes(&plan.arch, stem, &mod_abs_str)?;
    std::fs::write(install_path, &bytes)
        .map_err(|e| format!("write {}: {e}", install_path.display()))?;
    log(&format!(
        "→ wrote {} bytes to {}",
        bytes.len(),
        install_path.display()
    ));
    Ok(())
}

pub fn uninstall(
    game_dir: &Path,
    proxy_name: &str,
    log: &dyn Fn(&str),
) -> Result<(), String> {
    let install_path = game_dir.join(proxy_name);
    let backup_path = {
        let mut s = install_path.as_os_str().to_owned();
        s.push(BACKUP_SUFFIX);
        PathBuf::from(s)
    };

    if install_path.exists() {
        log(&format!("→ removing {}", install_path.display()));
        std::fs::remove_file(&install_path)
            .map_err(|e| format!("remove {}: {e}", install_path.display()))?;
    } else {
        log(&format!(
            "→ nothing to remove at {} (already gone?)",
            install_path.display()
        ));
    }

    if backup_path.exists() {
        log(&format!(
            "→ restoring backup {} → {}",
            backup_path.display(),
            install_path.display()
        ));
        std::fs::rename(&backup_path, &install_path).map_err(|e| {
            format!(
                "restore {}: {e}",
                backup_path.display()
            )
        })?;
    }
    Ok(())
}

const IMAGE_BASE: u64 = 0x0000_0001_8000_0000;
const SECTION_ALIGNMENT: u32 = 0x1000;
const FILE_ALIGNMENT: u32 = 0x200;

const TEXT_RVA: u32 = 0x1000;
const RDATA_RVA: u32 = 0x2000;
const EDATA_RVA: u32 = 0x3000;

const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;
const IMAGE_FILE_EXECUTABLE_IMAGE: u16 = 0x0002;
const IMAGE_FILE_LARGE_ADDRESS_AWARE: u16 = 0x0020;
const IMAGE_FILE_DLL: u16 = 0x2000;

const IMAGE_SCN_CNT_CODE: u32 = 0x0000_0020;
const IMAGE_SCN_CNT_INITIALIZED_DATA: u32 = 0x0000_0040;
const IMAGE_SCN_MEM_EXECUTE: u32 = 0x2000_0000;
const IMAGE_SCN_MEM_READ: u32 = 0x4000_0000;

const IMAGE_SUBSYSTEM_WINDOWS_CUI: u16 = 3;
const IMAGE_DLLCHARACTERISTICS_NX_COMPAT: u16 = 0x0100;

fn align_up(v: u32, a: u32) -> u32 {
    (v + a - 1) & !(a - 1)
}

fn stub_bytes(arch: &str, proxy_stem: &str, mod_path: &str) -> Result<Vec<u8>, String> {
    if arch != "x64" {
        return Err(format!(
            "internal error: stub_bytes only supports x64, got \"{arch}\""
        ));
    }
    let (forward_dll, exports) = exports_for(proxy_stem)?;

    let mut wide: Vec<u8> = Vec::with_capacity((mod_path.len() + 1) * 2);
    for u in mod_path.encode_utf16() {
        wide.extend_from_slice(&u.to_le_bytes());
    }
    wide.extend_from_slice(&[0, 0]);

    while wide.len() % 8 != 0 {
        wide.push(0);
    }
    let mod_padded = wide.len() as u32;

    let iid_off = mod_padded;
    let ilt_off = iid_off + 40;
    let iat_off = ilt_off + 16;
    let hint_name_off = iat_off + 16;

    let hint_name_size: u32 = 16;
    let k32_name_off = hint_name_off + hint_name_size;
    let k32_name = b"kernel32.dll\0";
    let rdata_vsize = k32_name_off + k32_name.len() as u32;

    let mod_path_rva = RDATA_RVA;
    let iid_rva = RDATA_RVA + iid_off;
    let ilt_rva = RDATA_RVA + ilt_off;
    let iat_rva = RDATA_RVA + iat_off;
    let hint_name_rva = RDATA_RVA + hint_name_off;
    let k32_name_rva = RDATA_RVA + k32_name_off;

    let mut rdata = Vec::with_capacity(rdata_vsize as usize);
    rdata.extend_from_slice(&wide);

    push_u32(&mut rdata, ilt_rva);
    push_u32(&mut rdata, 0);
    push_u32(&mut rdata, 0);
    push_u32(&mut rdata, k32_name_rva);
    push_u32(&mut rdata, iat_rva);

    for _ in 0..5 { push_u32(&mut rdata, 0); }

    push_u64(&mut rdata, hint_name_rva as u64);
    push_u64(&mut rdata, 0);

    push_u64(&mut rdata, hint_name_rva as u64);
    push_u64(&mut rdata, 0);

    rdata.extend_from_slice(&[0u8, 0u8]);
    rdata.extend_from_slice(b"LoadLibraryW\0");
    rdata.push(0);

    rdata.extend_from_slice(k32_name);
    debug_assert_eq!(rdata.len() as u32, rdata_vsize);

    let text = build_dllmain_code(mod_path_rva, iat_rva);
    let text_vsize = text.len() as u32;

    let n = exports.len() as u32;
    let export_dir_size: u32 = 40;
    let functions_off: u32 = export_dir_size;
    let names_off: u32 = functions_off + 4 * n;
    let ordinals_off: u32 = names_off + 4 * n;
    let strings_off: u32 = ordinals_off + 2 * n;

    let mut string_blob: Vec<u8> = Vec::new();
    let mut function_rvas: Vec<u32> = Vec::with_capacity(exports.len());
    let mut name_rvas: Vec<u32> = Vec::with_capacity(exports.len());
    for &name in exports {
        let rva = EDATA_RVA + strings_off + string_blob.len() as u32;
        name_rvas.push(rva);
        string_blob.extend_from_slice(name.as_bytes());
        string_blob.push(0);
    }
    for &name in exports {
        let rva = EDATA_RVA + strings_off + string_blob.len() as u32;
        function_rvas.push(rva);

        string_blob.extend_from_slice(forward_dll.as_bytes());
        string_blob.push(b'.');
        string_blob.extend_from_slice(name.as_bytes());
        string_blob.push(0);
    }
    let own_dll_name = format!("{proxy_stem}.dll\0");
    let own_dll_name_rva = EDATA_RVA + strings_off + string_blob.len() as u32;
    string_blob.extend_from_slice(own_dll_name.as_bytes());

    let edata_vsize = strings_off + string_blob.len() as u32;

    let mut edata: Vec<u8> = Vec::with_capacity(edata_vsize as usize);

    push_u32(&mut edata, 0);
    push_u32(&mut edata, 0);
    push_u16(&mut edata, 0);
    push_u16(&mut edata, 0);
    push_u32(&mut edata, own_dll_name_rva);
    push_u32(&mut edata, 1);
    push_u32(&mut edata, n);
    push_u32(&mut edata, n);
    push_u32(&mut edata, EDATA_RVA + functions_off);
    push_u32(&mut edata, EDATA_RVA + names_off);
    push_u32(&mut edata, EDATA_RVA + ordinals_off);
    for rva in &function_rvas { push_u32(&mut edata, *rva); }
    for rva in &name_rvas { push_u32(&mut edata, *rva); }
    for i in 0..n { push_u16(&mut edata, i as u16); }
    edata.extend_from_slice(&string_blob);
    debug_assert_eq!(edata.len() as u32, edata_vsize);

    let headers_end: u32 = 0x80 + 4 + 20 + 240 + 40 * 3;
    let size_of_headers = align_up(headers_end, FILE_ALIGNMENT);

    let text_raw = align_up(text_vsize, FILE_ALIGNMENT);
    let rdata_raw = align_up(rdata_vsize, FILE_ALIGNMENT);
    let edata_raw = align_up(edata_vsize, FILE_ALIGNMENT);

    let text_ptr = size_of_headers;
    let rdata_ptr = text_ptr + text_raw;
    let edata_ptr = rdata_ptr + rdata_raw;
    let total_file = edata_ptr + edata_raw;

    let size_of_image = align_up(EDATA_RVA + edata_vsize, SECTION_ALIGNMENT);

    let mut file = vec![0u8; total_file as usize];

    file[0] = b'M';
    file[1] = b'Z';
    write_u32(&mut file, 0x3C, 0x80);

    let pe = 0x80usize;
    file[pe] = b'P';
    file[pe + 1] = b'E';

    let fh = pe + 4;
    write_u16(&mut file, fh, IMAGE_FILE_MACHINE_AMD64);
    write_u16(&mut file, fh + 2, 3);
    write_u32(&mut file, fh + 4, 0);
    write_u32(&mut file, fh + 8, 0);
    write_u32(&mut file, fh + 12, 0);
    write_u16(&mut file, fh + 16, 240);
    write_u16(&mut file, fh + 18, IMAGE_FILE_EXECUTABLE_IMAGE
        | IMAGE_FILE_LARGE_ADDRESS_AWARE
        | IMAGE_FILE_DLL);

    let oh = fh + 20;
    write_u16(&mut file, oh, 0x20B);
    file[oh + 2] = 14;
    file[oh + 3] = 0;
    write_u32(&mut file, oh + 4, text_raw);
    write_u32(&mut file, oh + 8, rdata_raw + edata_raw);
    write_u32(&mut file, oh + 12, 0);
    write_u32(&mut file, oh + 16, TEXT_RVA);
    write_u32(&mut file, oh + 20, TEXT_RVA);
    write_u64(&mut file, oh + 24, IMAGE_BASE);
    write_u32(&mut file, oh + 32, SECTION_ALIGNMENT);
    write_u32(&mut file, oh + 36, FILE_ALIGNMENT);
    write_u16(&mut file, oh + 40, 6);
    write_u16(&mut file, oh + 42, 0);
    write_u16(&mut file, oh + 44, 0);
    write_u16(&mut file, oh + 46, 0);
    write_u16(&mut file, oh + 48, 6);
    write_u16(&mut file, oh + 50, 0);
    write_u32(&mut file, oh + 52, 0);
    write_u32(&mut file, oh + 56, size_of_image);
    write_u32(&mut file, oh + 60, size_of_headers);
    write_u32(&mut file, oh + 64, 0);
    write_u16(&mut file, oh + 68, IMAGE_SUBSYSTEM_WINDOWS_CUI);
    write_u16(&mut file, oh + 70, IMAGE_DLLCHARACTERISTICS_NX_COMPAT);
    write_u64(&mut file, oh + 72, 0x100000);
    write_u64(&mut file, oh + 80, 0x1000);
    write_u64(&mut file, oh + 88, 0x100000);
    write_u64(&mut file, oh + 96, 0x1000);
    write_u32(&mut file, oh + 104, 0);
    write_u32(&mut file, oh + 108, 16);

    write_u32(&mut file, oh + 112, EDATA_RVA);
    write_u32(&mut file, oh + 116, edata_vsize);

    write_u32(&mut file, oh + 120, iid_rva);
    write_u32(&mut file, oh + 124, 40);

    write_u32(&mut file, oh + 112 + 12 * 8, iat_rva);
    write_u32(&mut file, oh + 116 + 12 * 8, 16);

    let sh = oh + 240;
    write_section(&mut file, sh, b".text\0\0\0",
        text_vsize, TEXT_RVA, text_raw, text_ptr,
        IMAGE_SCN_CNT_CODE | IMAGE_SCN_MEM_EXECUTE | IMAGE_SCN_MEM_READ);
    write_section(&mut file, sh + 40, b".rdata\0\0",
        rdata_vsize, RDATA_RVA, rdata_raw, rdata_ptr,
        IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ);
    write_section(&mut file, sh + 80, b".edata\0\0",
        edata_vsize, EDATA_RVA, edata_raw, edata_ptr,
        IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ);

    file[text_ptr as usize..text_ptr as usize + text.len()].copy_from_slice(&text);
    file[rdata_ptr as usize..rdata_ptr as usize + rdata.len()].copy_from_slice(&rdata);
    file[edata_ptr as usize..edata_ptr as usize + edata.len()].copy_from_slice(&edata);

    Ok(file)
}

fn build_dllmain_code(mod_path_rva: u32, iat_rva: u32) -> Vec<u8> {

    let mut c = Vec::with_capacity(0x20);
    c.extend_from_slice(&[0x48, 0x83, 0xEC, 0x28]);
    c.extend_from_slice(&[0x83, 0xFA, 0x01]);
    c.extend_from_slice(&[0x75, 0x0D]);
    c.extend_from_slice(&[0x48, 0x8D, 0x0D]);
    let lea_next = TEXT_RVA + 0x10;
    let lea_disp = (mod_path_rva as i64 - lea_next as i64) as i32;
    c.extend_from_slice(&lea_disp.to_le_bytes());
    c.extend_from_slice(&[0xFF, 0x15]);
    let call_next = TEXT_RVA + 0x16;
    let call_disp = (iat_rva as i64 - call_next as i64) as i32;
    c.extend_from_slice(&call_disp.to_le_bytes());
    c.extend_from_slice(&[0xB8, 0x01, 0x00, 0x00, 0x00]);
    c.extend_from_slice(&[0x48, 0x83, 0xC4, 0x28]);
    c.push(0xC3);
    debug_assert_eq!(c.len(), 0x20);
    c
}

fn write_section(
    file: &mut [u8],
    off: usize,
    name: &[u8; 8],
    vsize: u32,
    vaddr: u32,
    raw_size: u32,
    raw_ptr: u32,
    chars: u32,
) {
    file[off..off + 8].copy_from_slice(name);
    write_u32(file, off + 8, vsize);
    write_u32(file, off + 12, vaddr);
    write_u32(file, off + 16, raw_size);
    write_u32(file, off + 20, raw_ptr);
    write_u32(file, off + 24, 0);
    write_u32(file, off + 28, 0);
    write_u16(file, off + 32, 0);
    write_u16(file, off + 34, 0);
    write_u32(file, off + 36, chars);
}

fn write_u16(b: &mut [u8], off: usize, v: u16) {
    b[off..off + 2].copy_from_slice(&v.to_le_bytes());
}
fn write_u32(b: &mut [u8], off: usize, v: u32) {
    b[off..off + 4].copy_from_slice(&v.to_le_bytes());
}
fn write_u64(b: &mut [u8], off: usize, v: u64) {
    b[off..off + 8].copy_from_slice(&v.to_le_bytes());
}
fn push_u16(v: &mut Vec<u8>, x: u16) { v.extend_from_slice(&x.to_le_bytes()); }
fn push_u32(v: &mut Vec<u8>, x: u32) { v.extend_from_slice(&x.to_le_bytes()); }
fn push_u64(v: &mut Vec<u8>, x: u64) { v.extend_from_slice(&x.to_le_bytes()); }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stub_is_well_formed_pe() {
        let bytes = stub_bytes("x64", "winhttp", r"C:\mods\example.dll").unwrap();
        assert_eq!(&bytes[0..2], b"MZ");
        let e_lfanew = u32::from_le_bytes([bytes[0x3C], bytes[0x3D], bytes[0x3E], bytes[0x3F]]) as usize;
        assert_eq!(&bytes[e_lfanew..e_lfanew + 4], b"PE\0\0");
        let machine = u16::from_le_bytes([bytes[e_lfanew + 4], bytes[e_lfanew + 5]]);
        assert_eq!(machine, IMAGE_FILE_MACHINE_AMD64);
    }

    #[test]
    fn version_stub_lists_all_exports() {
        let bytes = stub_bytes("x64", "version", r"C:\mods\example.dll").unwrap();

        for name in VERSION_EXPORTS {
            let needle = format!("version.{name}");
            assert!(bytes.windows(needle.len()).any(|w| w == needle.as_bytes()),
                "forwarder for {name} missing");
        }
    }

    #[test]
    fn rejects_x86() {
        let e = stub_bytes("x86", "winhttp", "C:\\x.dll").unwrap_err();
        assert!(e.contains("x64"));
    }
}
