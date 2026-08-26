

use super::memory::Memory;
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HMODULE, MAX_PATH, WAIT_TIMEOUT};
use windows::Win32::System::ProcessStatus as ps;
use windows::Win32::System::Threading as th;

const IMAGE_FILE_MACHINE_I386: u16 = 0x014c;
const IMAGE_FILE_MACHINE_AMD64: u16 = 0x8664;

fn wstr(buf: &[u16], len: usize) -> String {
    String::from_utf16_lossy(&buf[..len.min(buf.len())])
}

pub(super) fn pe_machine(bytes: &[u8]) -> Result<(u16, &'static str), String> {
    if bytes.len() < 0x40 || &bytes[..2] != b"MZ" {
        return Err("selected file is not a Windows DLL (missing MZ header)".into());
    }
    let e_lfanew = u32::from_le_bytes([bytes[0x3C], bytes[0x3D], bytes[0x3E], bytes[0x3F]]) as usize;
    if bytes.len() < e_lfanew + 6 || &bytes[e_lfanew..e_lfanew + 4] != b"PE\0\0" {
        return Err("selected file is not a valid PE image (no PE signature)".into());
    }
    let machine = u16::from_le_bytes([bytes[e_lfanew + 4], bytes[e_lfanew + 5]]);
    let label = match machine {
        IMAGE_FILE_MACHINE_AMD64 => "x64",
        IMAGE_FILE_MACHINE_I386 => "x86",
        _ => "unknown",
    };
    Ok((machine, label))
}

pub(super) fn looks_managed(bytes: &[u8]) -> bool {

    let Ok(e_lfanew) = (|| -> Result<usize, ()> {
        if bytes.len() < 0x40 {
            return Err(());
        }
        Ok(u32::from_le_bytes([bytes[0x3C], bytes[0x3D], bytes[0x3E], bytes[0x3F]]) as usize)
    })() else {
        return false;
    };
    let opt = e_lfanew + 0x18;
    if bytes.len() < opt + 2 {
        return false;
    }
    let magic = u16::from_le_bytes([bytes[opt], bytes[opt + 1]]);
    let is64 = magic == 0x20b;
    let dir = opt + if is64 { 0x70 } else { 0x60 } + 14 * 8;
    if bytes.len() < dir + 4 {
        return false;
    }
    let rva = u32::from_le_bytes([bytes[dir], bytes[dir + 1], bytes[dir + 2], bytes[dir + 3]]);
    rva != 0
}

pub(super) fn modules(handle: HANDLE) -> Result<Vec<(u64, String, String)>, String> {
    let mut needed = 0u32;
    unsafe {
        ps::EnumProcessModulesEx(handle, std::ptr::null_mut(), 0, &mut needed, ps::LIST_MODULES_ALL)
            .map_err(|e| format!("EnumProcessModulesEx(size): {e}"))?;
    }
    let count = (needed as usize) / std::mem::size_of::<HMODULE>();
    let mut mods = vec![HMODULE::default(); count.max(1)];
    unsafe {
        ps::EnumProcessModulesEx(
            handle,
            mods.as_mut_ptr(),
            (mods.len() * std::mem::size_of::<HMODULE>()) as u32,
            &mut needed,
            ps::LIST_MODULES_ALL,
        )
        .map_err(|e| format!("EnumProcessModulesEx: {e}"))?;
    }

    let mut out = Vec::new();
    for hm in mods.into_iter().filter(|m| !m.is_invalid()) {
        let mut buf = [0u16; MAX_PATH as usize];
        let len = unsafe { ps::GetModuleFileNameExW(handle, hm, &mut buf) } as usize;
        if len == 0 {
            continue;
        }
        let path = wstr(&buf, len);
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        out.push((hm.0 as u64, name, path));
    }
    Ok(out)
}

fn remote_proc_address(mem: &Memory, base: u64, is64: bool, want: &str) -> Result<u64, String> {
    let e_lfanew = mem.read_i32(base + 0x3C)? as u64;
    let nt = base + e_lfanew;
    let optional = nt + 0x18;
    let datadir = optional + if is64 { 0x70 } else { 0x60 };
    let export_rva = mem.read_i32(datadir)? as u64;
    if export_rva == 0 {
        return Err("kernel32 has no export directory".into());
    }
    let export_dir = base + export_rva;
    let num_names = mem.read_i32(export_dir + 0x18)? as usize;
    let names = base + mem.read_i32(export_dir + 0x20)? as u64;
    let ordinals = base + mem.read_i32(export_dir + 0x24)? as u64;
    let functions = base + mem.read_i32(export_dir + 0x1C)? as u64;

    let name_rvas = mem.read_bytes(names, num_names * 4)?;
    let ords = mem.read_bytes(ordinals, num_names * 2)?;

    for i in 0..num_names {
        if name_rvas.len() < i * 4 + 4 || ords.len() < i * 2 + 2 {
            break;
        }
        let name_rva = u32::from_le_bytes([
            name_rvas[i * 4],
            name_rvas[i * 4 + 1],
            name_rvas[i * 4 + 2],
            name_rvas[i * 4 + 3],
        ]) as u64;
        let name = mem.read_ascii(base + name_rva, 64)?;
        if name == want {
            let ordinal = u16::from_le_bytes([ords[i * 2], ords[i * 2 + 1]]) as u64;
            let func_rva = mem.read_i32(functions + ordinal * 4)? as u64;
            return Ok(base + func_rva);
        }
    }
    Err(format!("export not found in kernel32: {want}"))
}

pub fn inject(
    pid: u32,
    arch_x86: bool,
    dll_path: &str,
    timeout_ms: u32,
    log: &dyn Fn(&str),
) -> Result<(), String> {
    let is64 = !arch_x86;

    let bytes = std::fs::read(dll_path).map_err(|e| format!("read {dll_path}: {e}"))?;
    let (_machine, dll_arch) = pe_machine(&bytes)?;

    let target_arch = if is64 { "x64" } else { "x86" };
    if dll_arch != target_arch {
        return Err(format!(
            "architecture mismatch — the game is {target_arch} but this DLL is {dll_arch}. Build your native mod for {target_arch}."
        ));
    }

    if looks_managed(&bytes) {
        return Err(
            "this looks like a .NET/managed assembly, not a native DLL. Use the Direct or Pipe route for managed mods — native injection only runs a native DllMain."
                .into(),
        );
    }

    log(&format!("→ native mod is {dll_arch}, matches the {target_arch} game"));
    log(&format!("→ opening process {pid}"));
    let handle: HANDLE = unsafe { th::OpenProcess(th::PROCESS_ALL_ACCESS, false, pid) }
        .map_err(|e| format!("OpenProcess({pid}): {e} — try launching ZyMono as administrator"))?;

    let result = (|| -> Result<(), String> {
        log("→ locating kernel32 and resolving LoadLibraryW in the target");
        let mods = modules(handle)?;
        let (k32_base, _, _) = mods
            .iter()
            .find(|(_, name, _)| name == "kernel32.dll")
            .ok_or("kernel32.dll not found in the target process")?;

        let mut mem = Memory::new(handle);
        let load_library = remote_proc_address(&mem, *k32_base, is64, "LoadLibraryW")?;

        let mut wide: Vec<u8> = Vec::with_capacity((dll_path.len() + 1) * 2);
        for u in dll_path.encode_utf16() {
            wide.extend_from_slice(&u.to_le_bytes());
        }
        wide.extend_from_slice(&[0, 0]);
        log("→ writing the DLL path into the game and calling LoadLibraryW");
        let path_addr = mem.allocate_and_write(&wide)?;

        let exit_code = unsafe {
            let start: th::LPTHREAD_START_ROUTINE = std::mem::transmute(load_library as usize);
            let thread = th::CreateRemoteThread(
                handle,
                None,
                0,
                start,
                Some(path_addr as *const c_void),
                0,
                None,
            )
            .map_err(|e| format!("CreateRemoteThread: {e}"))?;

            let wait = th::WaitForSingleObject(thread, timeout_ms.max(1000));
            if wait == WAIT_TIMEOUT {
                let _ = CloseHandle(thread);
                return Err(format!(
                    "LoadLibrary timed out after {timeout_ms} ms — the DLL's DllMain may be blocking the loader"
                ));
            }
            let mut code = 0u32;
            let _ = th::GetExitCodeThread(thread, &mut code);
            let _ = CloseHandle(thread);
            code
        };

        if exit_code == 0 {
            return Err(
                "LoadLibraryW returned NULL in the game — the DLL failed to load. Common causes: a missing dependency, a DllMain that returned FALSE, or the file path being unreadable by the game's user."
                    .into(),
            );
        }

        let want = std::path::Path::new(dll_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if let Ok(after) = modules(handle) {
            if let Some((base, _, path)) = after.iter().find(|(_, name, _)| *name == want) {
                log(&format!("→ confirmed mapped at {base:#x} ({path})"));
                return Ok(());
            }
        }

        log("→ LoadLibraryW returned a non-null handle");
        Ok(())
    })();

    unsafe {
        let _ = CloseHandle(handle);
    }
    result
}
