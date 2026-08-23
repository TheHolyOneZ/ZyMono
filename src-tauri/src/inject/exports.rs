

#![allow(dead_code)]

use super::memory::Memory;
use std::collections::HashMap;
use windows::Win32::Foundation::{HMODULE, MAX_PATH};
use windows::Win32::System::ProcessStatus as ps;

pub struct Exports {
    map: HashMap<String, u64>,
}

pub const REQUIRED: [&str; 12] = [
    "mono_get_root_domain",
    "mono_thread_attach",
    "mono_image_open_from_data",
    "mono_assembly_load_from_full",
    "mono_assembly_get_image",
    "mono_class_from_name",
    "mono_class_get_method_from_name",
    "mono_runtime_invoke",
    "mono_assembly_close",
    "mono_image_strerror",
    "mono_object_get_class",
    "mono_class_get_name",
];

impl Exports {
    pub fn get(&self, name: &str) -> Result<u64, String> {
        self.map
            .get(name)
            .copied()
            .filter(|&a| a != 0)
            .ok_or_else(|| format!("runtime export not found: {name}"))
    }
}

fn wstr(buf: &[u16], len: usize) -> String {
    String::from_utf16_lossy(&buf[..len.min(buf.len())])
}

pub fn resolve(mem: &Memory, is64: bool) -> Result<(u64, Exports), String> {
    let handle = mem.handle();
    let mut needed = 0u32;
    unsafe {
        ps::EnumProcessModulesEx(handle, std::ptr::null_mut(), 0, &mut needed, ps::LIST_MODULES_ALL)
            .map_err(|e| format!("EnumProcessModulesEx(size): {e}"))?;
    }
    let count = (needed as usize) / std::mem::size_of::<HMODULE>();
    let mut modules = vec![HMODULE::default(); count.max(1)];
    unsafe {
        ps::EnumProcessModulesEx(
            handle,
            modules.as_mut_ptr(),
            (modules.len() * std::mem::size_of::<HMODULE>()) as u32,
            &mut needed,
            ps::LIST_MODULES_ALL,
        )
        .map_err(|e| format!("EnumProcessModulesEx: {e}"))?;
    }

    for hm in modules.into_iter().filter(|m| !m.is_invalid()) {
        let mut name_buf = [0u16; MAX_PATH as usize];
        let len = unsafe { ps::GetModuleFileNameExW(handle, hm, &mut name_buf) } as usize;
        if len == 0 {
            continue;
        }
        let path = wstr(&name_buf, len).to_lowercase();
        if !path.contains("mono") {
            continue;
        }
        let base = hm.0 as u64;
        if let Ok(map) = read_exports(mem, base, is64) {
            if map.get("mono_get_root_domain").copied().unwrap_or(0) != 0 {
                return Ok((base, Exports { map }));
            }
        }
    }
    Err("no Mono runtime module found in the target process".into())
}

fn read_exports(mem: &Memory, base: u64, is64: bool) -> Result<HashMap<String, u64>, String> {
    let e_lfanew = mem.read_i32(base + 0x3C)? as u64;
    let nt = base + e_lfanew;
    let optional = nt + 0x18;
    let datadir = optional + if is64 { 0x70 } else { 0x60 };
    let export_rva = mem.read_i32(datadir)? as u64;
    if export_rva == 0 {
        return Err("no export directory".into());
    }
    let export_dir = base + export_rva;
    let num_names = mem.read_i32(export_dir + 0x18)? as usize;
    let names = base + mem.read_i32(export_dir + 0x20)? as u64;
    let ordinals = base + mem.read_i32(export_dir + 0x24)? as u64;
    let functions = base + mem.read_i32(export_dir + 0x1C)? as u64;

    let name_rvas = mem.read_bytes(names, num_names * 4)?;
    let ords = mem.read_bytes(ordinals, num_names * 2)?;

    let mut want: std::collections::HashSet<&str> = REQUIRED.iter().copied().collect();

    want.insert("mono_string_new");

    want.insert("mono_assembly_name_new");
    want.insert("mono_assembly_loaded");
    let mut map: HashMap<String, u64> = HashMap::new();

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
        if want.contains(name.as_str()) {
            let ordinal = u16::from_le_bytes([ords[i * 2], ords[i * 2 + 1]]) as u64;
            let func_rva = mem.read_i32(functions + ordinal * 4)? as u64;
            map.insert(name, base + func_rva);
        }
    }
    Ok(map)
}
