

use super::memory::Memory;
use super::native::{looks_managed, modules, pe_machine};
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
use windows::Win32::System::Memory as winmem;
use windows::Win32::System::Threading as th;

const IMAGE_DIRECTORY_ENTRY_IMPORT: usize = 1;
const IMAGE_DIRECTORY_ENTRY_BASERELOC: usize = 5;
const IMAGE_DIRECTORY_ENTRY_TLS: usize = 9;

const IMAGE_REL_BASED_ABSOLUTE: u16 = 0;
const IMAGE_REL_BASED_HIGHLOW: u16 = 3;
const IMAGE_REL_BASED_DIR64: u16 = 10;

struct Section {
    va: u32,
    vsize: u32,
    raw_ptr: u32,
    raw_size: u32,
}

struct Pe {
    is64: bool,
    size_of_image: u32,
    size_of_headers: u32,
    entry_rva: u32,
    preferred_base: u64,
    import_rva: u32,
    reloc_rva: u32,
    reloc_size: u32,
    tls_rva: u32,
    sections: Vec<Section>,
}

fn r_u16(b: &[u8], o: usize) -> Result<u16, String> {
    if o + 2 > b.len() {
        return Err("PE truncated (u16)".into());
    }
    Ok(u16::from_le_bytes([b[o], b[o + 1]]))
}
fn r_u32(b: &[u8], o: usize) -> Result<u32, String> {
    if o + 4 > b.len() {
        return Err("PE truncated (u32)".into());
    }
    Ok(u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]))
}
fn r_u64(b: &[u8], o: usize) -> Result<u64, String> {
    if o + 8 > b.len() {
        return Err("PE truncated (u64)".into());
    }
    Ok(u64::from_le_bytes([
        b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7],
    ]))
}

fn parse_pe(bytes: &[u8]) -> Result<Pe, String> {
    let e_lfanew = r_u32(bytes, 0x3C)? as usize;
    let coff = e_lfanew + 4;
    let num_sections = r_u16(bytes, coff + 2)? as usize;
    let size_of_optional = r_u16(bytes, coff + 16)? as usize;

    let opt = e_lfanew + 0x18;
    let magic = r_u16(bytes, opt)?;
    let is64 = match magic {
        0x10b => false,
        0x20b => true,
        _ => return Err(format!("unknown PE optional-header magic {magic:#x}")),
    };

    let (preferred_base, dd_off) = if is64 {
        (r_u64(bytes, opt + 24)?, opt + 112)
    } else {
        (r_u32(bytes, opt + 28)? as u64, opt + 96)
    };
    let entry_rva = r_u32(bytes, opt + 16)?;
    let size_of_image = r_u32(bytes, opt + 56)?;
    let size_of_headers = r_u32(bytes, opt + 60)?;

    let import_rva = r_u32(bytes, dd_off + IMAGE_DIRECTORY_ENTRY_IMPORT * 8)?;
    let reloc_rva = r_u32(bytes, dd_off + IMAGE_DIRECTORY_ENTRY_BASERELOC * 8)?;
    let reloc_size = r_u32(bytes, dd_off + IMAGE_DIRECTORY_ENTRY_BASERELOC * 8 + 4)?;
    let tls_rva = r_u32(bytes, dd_off + IMAGE_DIRECTORY_ENTRY_TLS * 8)?;

    let sec_off = opt + size_of_optional;
    let mut sections = Vec::with_capacity(num_sections);
    for i in 0..num_sections {
        let s = sec_off + i * 40;
        sections.push(Section {
            vsize: r_u32(bytes, s + 8)?,
            va: r_u32(bytes, s + 12)?,
            raw_size: r_u32(bytes, s + 16)?,
            raw_ptr: r_u32(bytes, s + 20)?,
        });
    }

    Ok(Pe {
        is64,
        size_of_image,
        size_of_headers,
        entry_rva,
        preferred_base,
        import_rva,
        reloc_rva,
        reloc_size,
        tls_rva,
        sections,
    })
}

fn resolve_export(
    mem: &Memory,
    mod_base: u64,
    is64: bool,
    by_ordinal: Option<u16>,
    by_name: Option<&str>,
) -> Result<u64, String> {
    let e_lfanew = mem.read_i32(mod_base + 0x3C)? as u64;
    let optional = mod_base + e_lfanew + 0x18;
    let datadir = optional + if is64 { 0x70 } else { 0x60 };
    let export_rva = mem.read_i32(datadir)? as u64;
    if export_rva == 0 {
        return Err("target module has no export directory".into());
    }
    let export_dir = mod_base + export_rva;
    let ordinal_base = mem.read_i32(export_dir + 0x10)? as u32;
    let num_functions = mem.read_i32(export_dir + 0x14)? as usize;
    let num_names = mem.read_i32(export_dir + 0x18)? as usize;
    let functions = mod_base + mem.read_i32(export_dir + 0x1C)? as u64;
    let names = mod_base + mem.read_i32(export_dir + 0x20)? as u64;
    let ordinals = mod_base + mem.read_i32(export_dir + 0x24)? as u64;

    if let Some(ord) = by_ordinal {
        let idx = (ord as u32).wrapping_sub(ordinal_base) as usize;
        if idx >= num_functions {
            return Err(format!("ordinal {ord} out of range"));
        }
        let rva = mem.read_i32(functions + idx as u64 * 4)? as u64;
        return Ok(mod_base + rva);
    }

    let want = by_name.unwrap_or("");
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
        let name = mem.read_ascii(mod_base + name_rva, 256)?;
        if name == want {
            let idx = u16::from_le_bytes([ords[i * 2], ords[i * 2 + 1]]) as u64;
            let rva = mem.read_i32(functions + idx * 4)? as u64;
            return Ok(mod_base + rva);
        }
    }
    Err(format!("export not found: {want}"))
}

fn apply_relocations(mem: &Memory, base: u64, pe: &Pe, log: &dyn Fn(&str)) -> Result<(), String> {
    if pe.reloc_rva == 0 || pe.reloc_size == 0 {
        if base != pe.preferred_base {
            log("→ warning: DLL has no .reloc table but wasn't mapped at its preferred base — absolute references will be broken");
        }
        return Ok(());
    }
    let delta = base as i64 - pe.preferred_base as i64;
    if delta == 0 {
        return Ok(());
    }

    let mut cursor: u32 = 0;
    while cursor + 8 <= pe.reloc_size {
        let block_rva = mem.read_i32(base + pe.reloc_rva as u64 + cursor as u64)? as u32;
        let block_size = mem.read_i32(base + pe.reloc_rva as u64 + cursor as u64 + 4)? as u32;
        if block_size < 8 || block_size > pe.reloc_size - cursor {
            return Err(format!("malformed .reloc block at offset {cursor}"));
        }
        let entry_count = (block_size - 8) as usize / 2;
        let entries = mem.read_bytes(
            base + pe.reloc_rva as u64 + cursor as u64 + 8,
            entry_count * 2,
        )?;
        for i in 0..entry_count {
            if entries.len() < i * 2 + 2 {
                break;
            }
            let e = u16::from_le_bytes([entries[i * 2], entries[i * 2 + 1]]);
            let ty = e >> 12;
            let off = (e & 0x0FFF) as u32;
            let addr = base + block_rva as u64 + off as u64;
            match ty {
                IMAGE_REL_BASED_ABSOLUTE => {}
                IMAGE_REL_BASED_HIGHLOW => {
                    let v = mem.read_i32(addr)? as u32;
                    let patched = (v as i64 + delta) as u32;
                    mem.write(addr, &patched.to_le_bytes())?;
                }
                IMAGE_REL_BASED_DIR64 => {
                    let v = mem.read_i64(addr)? as u64;
                    let patched = (v as i64 + delta) as u64;
                    mem.write(addr, &patched.to_le_bytes())?;
                }
                other => {
                    return Err(format!(
                        "unsupported base relocation type {other} — only ABSOLUTE, HIGHLOW, and DIR64 are handled"
                    ));
                }
            }
        }
        cursor += block_size;
    }
    Ok(())
}

fn remote_load_library(
    mem: &mut Memory,
    handle: HANDLE,
    load_library_w: u64,
    name: &str,
    timeout_ms: u32,
) -> Result<u64, String> {
    let mut wide: Vec<u8> = Vec::with_capacity((name.len() + 1) * 2);
    for u in name.encode_utf16() {
        wide.extend_from_slice(&u.to_le_bytes());
    }
    wide.extend_from_slice(&[0, 0]);
    let path_addr = mem.allocate_and_write(&wide)?;
    unsafe {
        let start: th::LPTHREAD_START_ROUTINE = std::mem::transmute(load_library_w as usize);
        let thread = th::CreateRemoteThread(
            handle,
            None,
            0,
            start,
            Some(path_addr as *const c_void),
            0,
            None,
        )
        .map_err(|e| format!("CreateRemoteThread(LoadLibraryW {name}): {e}"))?;
        let wait = th::WaitForSingleObject(thread, timeout_ms.max(1000));
        let mut code = 0u32;
        if wait != WAIT_TIMEOUT {
            let _ = th::GetExitCodeThread(thread, &mut code);
        }
        let _ = CloseHandle(thread);
        if wait == WAIT_TIMEOUT {
            return Err(format!("LoadLibraryW({name}) timed out"));
        }
        Ok(code as u64)
    }
}

fn find_module<'a>(mods: &'a [(u64, String, String)], want: &str) -> Option<u64> {
    mods.iter().find(|(_, n, _)| n == want).map(|m| m.0)
}

fn apply_imports(
    mem: &mut Memory,
    handle: HANDLE,
    base: u64,
    pe: &Pe,
    k32_base: u64,
    load_library_w: u64,
    timeout_ms: u32,
    log: &dyn Fn(&str),
) -> Result<(), String> {
    if pe.import_rva == 0 {
        return Ok(());
    }
    let ptr_size: u64 = if pe.is64 { 8 } else { 4 };
    let high_bit: u64 = if pe.is64 { 1u64 << 63 } else { 1u64 << 31 };

    let mut known = modules(handle)?;
    let mut d = base + pe.import_rva as u64;
    loop {

        let name_rva = mem.read_i32(d + 12)? as u32;
        let iat_rva = mem.read_i32(d + 16)? as u32;
        if name_rva == 0 && iat_rva == 0 {
            break;
        }
        if iat_rva == 0 {
            return Err("import descriptor has no FirstThunk — refusing to write imports into the DOS header".into());
        }
        let int_rva = mem.read_i32(d)? as u32;
        let name = mem.read_ascii(base + name_rva as u64, 256)?;
        let name_lc = name.to_lowercase();

        let dep_base = if name_lc == "kernel32.dll" {
            k32_base
        } else if let Some(b) = find_module(&known, &name_lc) {
            b
        } else {
            log(&format!("→ loading dependency {name}"));
            let ret = remote_load_library(mem, handle, load_library_w, &name, timeout_ms)?;
            if ret == 0 {
                return Err(format!(
                    "the mod imports {name} but LoadLibraryW couldn't load it in the game (missing file or unresolved import)"
                ));
            }
            known = modules(handle)?;
            find_module(&known, &name_lc).ok_or_else(|| {
                format!("loaded {name} but couldn't find its base afterwards")
            })?
        };

        let read_from = if int_rva != 0 { int_rva } else { iat_rva };
        let mut i: u64 = 0;
        loop {
            let src = base + read_from as u64 + i * ptr_size;
            let thunk = mem.read_ptr(src, pe.is64)?;
            if thunk == 0 {
                break;
            }
            let addr = if thunk & high_bit != 0 {
                let ord = (thunk & 0xFFFF) as u16;
                resolve_export(mem, dep_base, pe.is64, Some(ord), None)
                    .map_err(|e| format!("{name}#{ord}: {e}"))?
            } else {

                let sym = mem.read_ascii(base + thunk + 2, 512)?;
                resolve_export(mem, dep_base, pe.is64, None, Some(&sym))
                    .map_err(|e| format!("{name}!{sym}: {e}"))?
            };
            let dst = base + iat_rva as u64 + i * ptr_size;
            if pe.is64 {
                mem.write(dst, &addr.to_le_bytes())?;
            } else {
                mem.write(dst, &(addr as u32).to_le_bytes())?;
            }
            i += 1;
        }

        d += 20;
    }
    Ok(())
}

fn build_dllmain_shellcode(is64: bool, entry: u64, base: u64, ret_slot: u64) -> Vec<u8> {
    let mut c: Vec<u8> = Vec::new();
    if is64 {

        c.extend_from_slice(&[0x48, 0x83, 0xEC, 0x28]);

        c.extend_from_slice(&[0x48, 0xB9]);
        c.extend_from_slice(&base.to_le_bytes());

        c.extend_from_slice(&[0xBA, 0x01, 0x00, 0x00, 0x00]);

        c.extend_from_slice(&[0x45, 0x31, 0xC0]);

        c.extend_from_slice(&[0x48, 0xB8]);
        c.extend_from_slice(&entry.to_le_bytes());

        c.extend_from_slice(&[0xFF, 0xD0]);

        c.extend_from_slice(&[0x48, 0x83, 0xC4, 0x28]);

        c.extend_from_slice(&[0x48, 0xA3]);
        c.extend_from_slice(&ret_slot.to_le_bytes());
        c.push(0xC3);
    } else {

        c.extend_from_slice(&[0x6A, 0x00]);

        c.extend_from_slice(&[0x6A, 0x01]);

        c.push(0x68);
        c.extend_from_slice(&(base as u32).to_le_bytes());

        c.push(0xB8);
        c.extend_from_slice(&(entry as u32).to_le_bytes());

        c.extend_from_slice(&[0xFF, 0xD0]);

        c.push(0xA3);
        c.extend_from_slice(&(ret_slot as u32).to_le_bytes());
        c.push(0xC3);
    }
    c
}

pub fn inject(
    pid: u32,
    arch_x86: bool,
    dll_path: &str,
    timeout_ms: u32,
    log: &dyn Fn(&str),
) -> Result<(), String> {
    let is64 = !arch_x86;
    let target_arch = if is64 { "x64" } else { "x86" };

    let bytes = std::fs::read(dll_path).map_err(|e| format!("read {dll_path}: {e}"))?;
    let (_machine, dll_arch) = pe_machine(&bytes)?;
    if dll_arch != target_arch {
        return Err(format!(
            "architecture mismatch — the game is {target_arch} but this DLL is {dll_arch}. Build your native mod for {target_arch}."
        ));
    }
    if looks_managed(&bytes) {
        return Err(
            "this looks like a .NET/managed assembly, not a native DLL. Use the Direct or Pipe route for managed mods — manual mapping only runs a native DllMain."
                .into(),
        );
    }

    let pe = parse_pe(&bytes)?;
    if pe.is64 != is64 {
        return Err(
            "PE optional-header bitness disagrees with the COFF machine type — refusing to map".into(),
        );
    }
    if (bytes.len() as u64) < pe.size_of_headers as u64 {
        return Err("PE file is truncated (smaller than SizeOfHeaders)".into());
    }
    if pe.size_of_image == 0 {
        return Err("PE reports SizeOfImage = 0".into());
    }

    log(&format!("→ native mod is {dll_arch}, matches the {target_arch} game"));
    log(&format!("→ opening process {pid}"));
    let handle: HANDLE = unsafe { th::OpenProcess(th::PROCESS_ALL_ACCESS, false, pid) }
        .map_err(|e| format!("OpenProcess({pid}): {e} — try launching ZyMono as administrator"))?;

    let result = (|| -> Result<(), String> {
        log("→ locating kernel32 and resolving LoadLibraryW in the target");
        let mods = modules(handle)?;
        let k32_base = find_module(&mods, "kernel32.dll")
            .ok_or("kernel32.dll not found in the target process")?;

        let mut mem = Memory::new(handle);
        let load_library_w = resolve_export(&mem, k32_base, is64, None, Some("LoadLibraryW"))?;

        let region = unsafe {
            winmem::VirtualAllocEx(
                handle,
                None,
                pe.size_of_image as usize,
                winmem::MEM_COMMIT | winmem::MEM_RESERVE,
                winmem::PAGE_EXECUTE_READWRITE,
            )
        };
        if region.is_null() {
            return Err(format!(
                "VirtualAllocEx({} bytes) failed — the game may be out of address space",
                pe.size_of_image
            ));
        }
        let base = region as u64;
        log(&format!(
            "→ reserved {} bytes at {base:#x} for the mapped image",
            pe.size_of_image
        ));

        let mapped = (|| -> Result<(), String> {
            log("→ writing headers and sections");
            mem.write(base, &bytes[..pe.size_of_headers as usize])?;
            for s in &pe.sections {
                if s.raw_size == 0 {
                    continue;
                }
                let raw_end = s.raw_ptr as usize + s.raw_size as usize;
                if raw_end > bytes.len() {
                    return Err(format!(
                        "section at raw {:#x}+{:#x} runs past the file",
                        s.raw_ptr, s.raw_size
                    ));
                }
                let n = if s.vsize > 0 {
                    std::cmp::min(s.raw_size, s.vsize) as usize
                } else {
                    s.raw_size as usize
                };
                mem.write(
                    base + s.va as u64,
                    &bytes[s.raw_ptr as usize..s.raw_ptr as usize + n],
                )?;
            }

            log("→ applying base relocations");
            apply_relocations(&mem, base, &pe, log)?;

            log("→ resolving imports");
            apply_imports(&mut mem, handle, base, &pe, k32_base, load_library_w, timeout_ms, log)?;

            if pe.tls_rva != 0 {
                log("→ warning: DLL declares TLS callbacks — this loader does not run them, so per-thread TLS init inside the mod may not fire");
            }

            if pe.entry_rva == 0 {

                log("→ no DllMain (entry-point RVA is 0); map complete");
                return Ok(());
            }
            let entry = base + pe.entry_rva as u64;

            log(&format!("→ calling DllMain at {entry:#x} with DLL_PROCESS_ATTACH"));
            let ret_slot = mem.allocate(8)?;
            let shellcode = build_dllmain_shellcode(is64, entry, base, ret_slot);
            let code_addr = mem.allocate_and_write(&shellcode)?;

            let ret = unsafe {
                let start: th::LPTHREAD_START_ROUTINE = std::mem::transmute(code_addr as usize);
                let thread = th::CreateRemoteThread(
                    handle,
                    None,
                    0,
                    start,
                    Some(code_addr as *const c_void),
                    0,
                    None,
                )
                .map_err(|e| format!("CreateRemoteThread(DllMain): {e}"))?;
                let wait = th::WaitForSingleObject(thread, timeout_ms.max(1000));
                if wait == WAIT_TIMEOUT {
                    let _ = CloseHandle(thread);
                    return Err(format!(
                        "DllMain timed out after {timeout_ms} ms — the mod's DllMain may be blocking the game"
                    ));
                }
                let _ = CloseHandle(thread);
                mem.read_ptr(ret_slot, is64)?
            };

            if (ret as u32) == 0 {
                return Err(
                    "DllMain returned FALSE — the mod refused to load. Check its dependencies and any console output on the game side."
                        .into(),
                );
            }

            log(&format!("→ mod mapped and initialised at {base:#x}"));
            Ok(())
        })();

        if mapped.is_err() {

            unsafe {
                let _ = winmem::VirtualFreeEx(handle, region, 0, winmem::MEM_RELEASE);
            }
        }
        mapped
    })();

    unsafe {
        let _ = CloseHandle(handle);
    }
    result
}
