

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct EntryPoint {
    pub namespace: String,
    pub class: String,
    pub method: String,
    pub is_static: bool,
    pub param_count: u32,
    pub returns_void: bool,
}

pub fn list_entry_points(path: &str) -> Result<Vec<EntryPoint>, String> {
    let data = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    parse(&data).ok_or_else(|| "could not parse .NET metadata (not a managed assembly?)".into())
}

pub fn assembly_references(path: &str) -> Result<Vec<String>, String> {
    let data = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let mut refs = parse_refs(&data).unwrap_or_default();

    for name in ["0Harmony", "HarmonyLib", "BepInEx"] {
        if !refs.iter().any(|r| r.eq_ignore_ascii_case(name)) && contains_bytes(&data, name.as_bytes())
        {
            refs.push(name.to_string());
        }
    }
    Ok(refs)
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    needle.len() <= haystack.len() && haystack.windows(needle.len()).any(|w| w == needle)
}

fn u16_(d: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes(d.get(o..o + 2)?.try_into().ok()?))
}
fn u32_(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(o..o + 4)?.try_into().ok()?))
}
fn u64_(d: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(d.get(o..o + 8)?.try_into().ok()?))
}
fn idx(d: &[u8], o: usize, size: usize) -> Option<u32> {
    if size == 2 {
        u16_(d, o).map(|v| v as u32)
    } else {
        u32_(d, o)
    }
}

fn compressed(d: &[u8], o: usize) -> Option<(u32, usize)> {
    let b0 = *d.get(o)?;
    if b0 & 0x80 == 0 {
        Some((b0 as u32, 1))
    } else if b0 & 0xC0 == 0x80 {
        let b1 = *d.get(o + 1)? as u32;
        Some((((b0 & 0x3F) as u32) << 8 | b1, 2))
    } else {
        let b1 = *d.get(o + 1)? as u32;
        let b2 = *d.get(o + 2)? as u32;
        let b3 = *d.get(o + 3)? as u32;
        Some((((b0 & 0x1F) as u32) << 24 | b1 << 16 | b2 << 8 | b3, 4))
    }
}

fn read_string(d: &[u8], strings_off: usize, i: u32) -> String {
    let start = strings_off + i as usize;
    let sub = match d.get(start..) {
        Some(s) => s,
        None => return String::new(),
    };
    let end = sub.iter().position(|&b| b == 0).unwrap_or(sub.len());
    String::from_utf8_lossy(&sub[..end]).into_owned()
}

fn sig_info(d: &[u8], blob_off: usize, i: u32) -> (u32, bool) {
    (|| -> Option<(u32, bool)> {
        let mut p = blob_off + i as usize;
        let (_len, n) = compressed(d, p)?;
        p += n;
        let cc = *d.get(p)?;
        p += 1;
        if cc & 0x10 != 0 {
            let (_, n) = compressed(d, p)?;
            p += n;
        }
        let (pc, n) = compressed(d, p)?;
        p += n;
        let ret_void = d.get(p).copied() == Some(0x01);
        Some((pc, ret_void))
    })()
    .unwrap_or((0, false))
}

struct Section {
    va: u32,
    vsize: u32,
    raw_ptr: u32,
    raw_size: u32,
}
fn rva_to_off(secs: &[Section], rva: u32) -> Option<usize> {
    for s in secs {
        let span = s.vsize.max(s.raw_size);
        if rva >= s.va && rva < s.va + span {
            return Some((s.raw_ptr + (rva - s.va)) as usize);
        }
    }
    None
}

const T_MODULE: usize = 0x00;
const T_TYPEREF: usize = 0x01;
const T_TYPEDEF: usize = 0x02;
const T_FIELDPTR: usize = 0x03;
const T_FIELD: usize = 0x04;
const T_METHODPTR: usize = 0x05;
const T_METHODDEF: usize = 0x06;
const T_PARAM: usize = 0x08;
const T_MODULEREF: usize = 0x1A;
const T_TYPESPEC: usize = 0x1B;
const T_ASSEMBLYREF: usize = 0x23;

const MD_STATIC: u16 = 0x0010;

struct Tables {
    tables_off: usize,
    strings_off: usize,
    blob_off: usize,
    str_i: usize,
    blob_i: usize,
    rc: [u32; 64],
    data_start: usize,
    secs: Vec<Section>,
}

fn read_tables(d: &[u8]) -> Option<Tables> {
    let e_lfanew = u32_(d, 0x3C)? as usize;
    if d.get(e_lfanew..e_lfanew + 4)? != b"PE\0\0" {
        return None;
    }
    let coff = e_lfanew + 4;
    let num_sections = u16_(d, coff + 2)? as usize;
    let opt_size = u16_(d, coff + 16)? as usize;
    let opt = coff + 20;
    let magic = u16_(d, opt)?;
    let datadir = match magic {
        0x10B => opt + 96,
        0x20B => opt + 112,
        _ => return None,
    };
    let cli_rva = u32_(d, datadir + 14 * 8)?;
    if cli_rva == 0 {
        return None;
    }

    let sec_start = opt + opt_size;
    let mut secs = Vec::with_capacity(num_sections);
    for i in 0..num_sections {
        let b = sec_start + i * 40;
        secs.push(Section {
            va: u32_(d, b + 12)?,
            vsize: u32_(d, b + 8)?,
            raw_ptr: u32_(d, b + 20)?,
            raw_size: u32_(d, b + 16)?,
        });
    }

    let cli_off = rva_to_off(&secs, cli_rva)?;
    let md_rva = u32_(d, cli_off + 8)?;
    let md = rva_to_off(&secs, md_rva)?;
    if u32_(d, md)? != 0x424A5342 {
        return None;
    }
    let ver_len = u32_(d, md + 12)? as usize;
    let after_ver = md + 16 + ((ver_len + 3) & !3);
    let n_streams = u16_(d, after_ver + 2)? as usize;

    let mut tables_off = None;
    let mut strings_off = None;
    let mut blob_off = None;
    let mut cur = after_ver + 4;
    for _ in 0..n_streams {
        let off = u32_(d, cur)? as usize;
        let _size = u32_(d, cur + 4)?;
        let name_start = cur + 8;
        let name_bytes = d.get(name_start..)?;
        let nlen = name_bytes.iter().position(|&b| b == 0)?;
        let name = &name_bytes[..nlen];
        let padded = (nlen + 1 + 3) & !3;
        cur = name_start + padded;
        if name == b"#~" || name == b"#-" {
            tables_off = Some(md + off);
        } else if name == b"#Strings" {
            strings_off = Some(md + off);
        } else if name == b"#Blob" {
            blob_off = Some(md + off);
        }
    }
    let tables_off = tables_off?;
    let strings_off = strings_off?;
    let blob_off = blob_off.unwrap_or(0);

    let heap_sizes = *d.get(tables_off + 6)?;
    let valid = u64_(d, tables_off + 8)?;
    let str_i = if heap_sizes & 0x01 != 0 { 4 } else { 2 };
    let blob_i = if heap_sizes & 0x04 != 0 { 4 } else { 2 };

    let mut rc = [0u32; 64];
    let mut cursor = tables_off + 24;
    for id in 0..64usize {
        if valid & (1u64 << id) != 0 {
            rc[id] = u32_(d, cursor)?;
            cursor += 4;
        }
    }
    let data_start = cursor;

    Some(Tables {
        tables_off,
        strings_off,
        blob_off,
        str_i,
        blob_i,
        rc,
        data_start,
        secs,
    })
}

fn parse(d: &[u8]) -> Option<Vec<EntryPoint>> {
    let t = read_tables(d)?;
    let (strings_off, blob_off, str_i, blob_i, rc, data_start) =
        (t.strings_off, t.blob_off, t.str_i, t.blob_i, t.rc, t.data_start);
    let _ = (t.tables_off, &t.secs);

    let heap_sizes_guid = 2;
    let guid_i = heap_sizes_guid;

    let guid_i = {
        let hs = *d.get(t.tables_off + 6)?;
        if hs & 0x02 != 0 {
            4
        } else {
            guid_i
        }
    };

    let simple = |t: usize| -> usize { if rc[t] < 65536 { 2 } else { 4 } };
    let coded = |tables: &[usize], bits: u32| -> usize {
        let max = tables.iter().map(|&t| rc[t]).max().unwrap_or(0) as u64;
        if max < (1u64 << (16 - bits)) {
            2
        } else {
            4
        }
    };

    let sz_module = 2 + str_i + 3 * guid_i;
    let sz_typeref = coded(&[T_MODULE, T_MODULEREF, T_ASSEMBLYREF, T_TYPEREF], 2) + 2 * str_i;
    let sz_typedef = 4
        + 2 * str_i
        + coded(&[T_TYPEDEF, T_TYPEREF, T_TYPESPEC], 2)
        + simple(T_FIELD)
        + simple(T_METHODDEF);
    let sz_fieldptr = simple(T_FIELD);
    let sz_field = 2 + str_i + blob_i;
    let sz_methodptr = simple(T_METHODDEF);
    let sz_methoddef = 4 + 2 + 2 + str_i + blob_i + simple(T_PARAM);

    let typedef_off =
        data_start + rc[T_MODULE] as usize * sz_module + rc[T_TYPEREF] as usize * sz_typeref;
    let methoddef_off = typedef_off
        + rc[T_TYPEDEF] as usize * sz_typedef
        + rc[T_FIELDPTR] as usize * sz_fieldptr
        + rc[T_FIELD] as usize * sz_field
        + rc[T_METHODPTR] as usize * sz_methodptr;

    let coded_typedeforref = coded(&[T_TYPEDEF, T_TYPEREF, T_TYPESPEC], 2);
    let method_list_col = 4 + 2 * str_i + coded_typedeforref + simple(T_FIELD);

    struct Ty {
        ns: String,
        name: String,
        method_start: u32,
    }
    let mut types = Vec::with_capacity(rc[T_TYPEDEF] as usize);
    for i in 0..rc[T_TYPEDEF] as usize {
        let base = typedef_off + i * sz_typedef;
        let name_i = idx(d, base + 4, str_i)?;
        let ns_i = idx(d, base + 4 + str_i, str_i)?;
        let method_start = idx(d, base + method_list_col, simple(T_METHODDEF))?;
        types.push(Ty {
            ns: read_string(d, strings_off, ns_i),
            name: read_string(d, strings_off, name_i),
            method_start,
        });
    }

    let mut out = Vec::new();
    let n_methods = rc[T_METHODDEF];
    for i in 0..types.len() {
        let start = types[i].method_start;
        let end = if i + 1 < types.len() {
            types[i + 1].method_start
        } else {
            n_methods + 1
        };
        for j in start..end {
            if j == 0 || j > n_methods {
                continue;
            }
            let base = methoddef_off + (j - 1) as usize * sz_methoddef;
            let flags = match u16_(d, base + 6) {
                Some(f) => f,
                None => continue,
            };
            let name_i = match idx(d, base + 8, str_i) {
                Some(v) => v,
                None => continue,
            };
            let sig_i = match idx(d, base + 8 + str_i, blob_i) {
                Some(v) => v,
                None => continue,
            };
            let name = read_string(d, strings_off, name_i);
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let (param_count, returns_void) = sig_info(d, blob_off, sig_i);
            out.push(EntryPoint {
                namespace: types[i].ns.clone(),
                class: types[i].name.clone(),
                method: name,
                is_static: flags & MD_STATIC != 0,
                param_count,
                returns_void,
            });
        }
    }

    Some(out)
}

fn parse_refs(d: &[u8]) -> Option<Vec<String>> {
    let t = read_tables(d)?;
    let str_i = t.str_i;
    let rc = t.rc;
    let data_start = t.data_start;

    let guid_i = {
        let hs = *d.get(t.tables_off + 6)?;
        if hs & 0x02 != 0 {
            4
        } else {
            2
        }
    };
    let blob_i = t.blob_i;

    let simple = |tt: usize| -> usize { if rc[tt] < 65536 { 2 } else { 4 } };
    let coded = |tables: &[usize], bits: u32| -> usize {
        let max = tables.iter().map(|&tt| rc[tt]).max().unwrap_or(0) as u64;
        if max < (1u64 << (16 - bits)) {
            2
        } else {
            4
        }
    };

    let sz = |id: usize| -> usize {
        match id {
            T_MODULE => 2 + str_i + 3 * guid_i,
            T_TYPEREF => coded(&[T_MODULE, T_MODULEREF, T_ASSEMBLYREF, T_TYPEREF], 2) + 2 * str_i,
            T_TYPEDEF => {
                4 + 2 * str_i
                    + coded(&[T_TYPEDEF, T_TYPEREF, T_TYPESPEC], 2)
                    + simple(T_FIELD)
                    + simple(T_METHODDEF)
            }
            T_FIELDPTR => simple(T_FIELD),
            T_FIELD => 2 + str_i + blob_i,
            T_METHODPTR => simple(T_METHODDEF),
            T_METHODDEF => 4 + 2 + 2 + str_i + blob_i + simple(T_PARAM),
            0x07 => coded(&[T_METHODDEF, T_FIELD], 1),
            T_PARAM => 2 + 2 + str_i,
            0x09 => {

                simple(T_TYPEDEF) + coded(&[T_TYPEDEF, T_TYPEREF, T_TYPESPEC], 2)
            }
            0x0A => {

                coded(&[T_TYPEDEF, T_TYPEREF, T_MODULEREF, T_METHODDEF, T_TYPESPEC], 3)
                    + str_i
                    + blob_i
            }
            0x0B => {

                2 + coded(&[T_FIELD, T_PARAM, 0x17], 2) + blob_i
            }
            0x0C => {

                coded(
                    &[
                        T_METHODDEF,
                        T_FIELD,
                        T_TYPEREF,
                        T_TYPEDEF,
                        T_PARAM,
                        0x09,
                        0x0A,
                        T_MODULE,
                        0x0E,
                        0x11,
                        T_MODULEREF,
                        T_TYPESPEC,
                        T_ASSEMBLYREF,
                    ],
                    5,
                ) + coded(&[0x0A, T_METHODDEF], 3)
                    + blob_i
            }
            0x0D => {

                coded(&[T_FIELD, T_PARAM], 1) + blob_i
            }
            0x0E => {

                2 + coded(&[T_TYPEDEF, T_METHODDEF, T_ASSEMBLYREF], 2) + blob_i
            }
            0x0F => {

                2 + 4 + simple(T_TYPEDEF)
            }
            0x10 => {

                4 + simple(T_FIELD)
            }
            0x11 => {

                blob_i
            }
            0x12 => {

                simple(T_TYPEDEF) + simple(0x14)
            }
            0x14 => {

                2 + str_i + coded(&[T_TYPEDEF, T_TYPEREF, T_TYPESPEC], 2)
            }
            0x15 => {

                simple(T_TYPEDEF) + simple(0x17)
            }
            0x17 => {

                2 + str_i + blob_i
            }
            0x18 => {

                2 + simple(T_METHODDEF) + coded(&[0x14, 0x17], 1)
            }
            0x19 => {

                simple(T_TYPEDEF) + 2 * coded(&[T_METHODDEF, 0x0A], 1)
            }
            T_MODULEREF => str_i,
            T_TYPESPEC => blob_i,
            0x1C => {

                2 + coded(&[T_FIELD, T_METHODDEF], 1) + str_i + simple(T_MODULEREF)
            }
            0x1D => {

                4 + simple(T_FIELD)
            }
            _ => 0,
        }
    };

    let mut off = data_start;
    for id in 0..T_ASSEMBLYREF {
        off += rc[id] as usize * sz(id);
    }

    let sz_assemblyref = 2 + 2 + 2 + 2 + 4 + blob_i + str_i + str_i + blob_i;
    let name_col = 2 + 2 + 2 + 2 + 4 + blob_i;

    let mut names = Vec::new();
    for i in 0..rc[T_ASSEMBLYREF] as usize {
        let base = off + i * sz_assemblyref;
        if let Some(name_i) = idx(d, base + name_col, str_i) {
            let n = read_string(d, t.strings_off, name_i);
            if !n.is_empty() {
                names.push(n);
            }
        }
    }
    Some(names)
}
