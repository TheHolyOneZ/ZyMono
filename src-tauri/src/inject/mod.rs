

pub mod assembler;
pub mod exports;
pub mod memory;

use assembler::Stub;
use exports::Exports;
use memory::Memory;
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_TIMEOUT};
use windows::Win32::System::Threading as th;

const STATUS_ACCESS_VIOLATION: u64 = 0xC0000005;

fn alloc_cstr(mem: &mut Memory, s: &str) -> Result<u64, String> {
    let mut bytes = s.as_bytes().to_vec();
    bytes.push(0);
    mem.allocate_and_write(&bytes)
}

struct Engine<'a> {
    mem: &'a mut Memory,
    is64: bool,
    attach: bool,
    thread_attach_fn: u64,
    root_domain: u64,
    timeout_ms: u32,
}

impl<'a> Engine<'a> {
    fn execute(&mut self, function: u64, args: &[u64]) -> Result<u64, String> {
        let ret_slot = self.mem.allocate(8)?;
        let mut stub = Stub::new(self.is64);
        if self.attach {
            stub = stub.with_attach(self.thread_attach_fn, self.root_domain);
        }
        let code = stub.build(function, ret_slot, args);
        let code_addr = self.mem.allocate_and_write(&code)?;

        let handle = self.mem.handle();
        unsafe {
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
            .map_err(|e| format!("CreateRemoteThread: {e}"))?;

            let wait = th::WaitForSingleObject(thread, self.timeout_ms);
            let _ = CloseHandle(thread);
            if wait == WAIT_TIMEOUT {
                return Err(format!(
                    "injection timed out after {} ms — the entry point may be blocking, or the game is unresponsive",
                    self.timeout_ms
                ));
            }
        }

        let ret = self.mem.read_ptr(ret_slot, self.is64)?;
        if ret == STATUS_ACCESS_VIOLATION {
            return Err(format!("fault while executing remote call at {function:#x}"));
        }
        Ok(ret)
    }
}

fn read_mono_string(eng: &Engine, s: u64) -> Result<String, String> {
    let (len_off, chars_off) = if eng.is64 { (0x10u64, 0x14u64) } else { (0x8, 0xC) };
    let len = eng.mem.read_i32(s + len_off)? as usize;
    if len == 0 || len > 8192 {
        return Ok(String::new());
    }
    eng.mem.read_utf16(s + chars_off, len)
}

fn read_exception(eng: &mut Engine, ex: &Exports, exc: u64) -> String {
    let class_name = (|| -> Result<String, String> {
        let klass = eng.execute(ex.get("mono_object_get_class")?, &[exc])?;
        let name_ptr = eng.execute(ex.get("mono_class_get_name")?, &[klass])?;
        if name_ptr == 0 {
            Ok("Exception".into())
        } else {
            eng.mem.read_ascii(name_ptr, 256)
        }
    })()
    .unwrap_or_else(|_| "Exception".into());

    let msg_off = if eng.is64 { 0x20 } else { 0x10 };
    let message = (|| -> Result<String, String> {
        let field = eng.mem.read_ptr(exc + msg_off, eng.is64)?;
        if field == 0 {
            Ok(String::new())
        } else {
            read_mono_string(eng, field)
        }
    })()
    .unwrap_or_default();

    if message.is_empty() {
        format!("managed exception: {class_name}")
    } else {
        format!("managed exception: {class_name}: {message}")
    }
}

fn run_sequence(
    eng: &mut Engine,
    ex: &Exports,
    assembly: &[u8],
    namespace: &str,
    class_name: &str,
    method: &str,
    args: &[String],
    log: &dyn Fn(&str),
) -> Result<(), String> {
    log("→ getting root domain");
    eng.root_domain = eng.execute(ex.get("mono_get_root_domain")?, &[])?;
    if eng.root_domain == 0 {
        return Err("mono_get_root_domain returned null".into());
    }

    log("→ writing assembly into the target and opening the image");
    let status_ptr = eng.mem.allocate(4)?;
    let data_ptr = eng.mem.allocate_and_write(assembly)?;
    let image = eng.execute(
        ex.get("mono_image_open_from_data")?,
        &[data_ptr, assembly.len() as u64, 1, status_ptr],
    )?;
    let status = eng.mem.read_i32(status_ptr)?;
    if status != 0 {
        let sp = eng
            .execute(ex.get("mono_image_strerror")?, &[status as u64])
            .unwrap_or(0);
        let msg = if sp != 0 {
            eng.mem.read_ascii(sp, 256).unwrap_or_default()
        } else {
            format!("status {status}")
        };
        return Err(format!("image open failed: {msg}"));
    }
    if image == 0 {
        return Err("image open returned null".into());
    }

    eng.attach = true;
    eng.thread_attach_fn = ex.get("mono_thread_attach")?;

    let status2 = eng.mem.allocate(4)?;
    let empty_name = eng.mem.allocate_and_write(&[0u8])?;
    let assembly_handle = eng.execute(
        ex.get("mono_assembly_load_from_full")?,
        &[image, empty_name, status2, 0],
    )?;
    if assembly_handle == 0 {
        return Err("mono_assembly_load_from_full returned null".into());
    }

    let image2 = eng.execute(ex.get("mono_assembly_get_image")?, &[assembly_handle])?;

    log("→ resolving the entry point");
    let ns_ptr = alloc_cstr(eng.mem, namespace)?;
    let class_ptr = alloc_cstr(eng.mem, class_name)?;
    let klass = eng.execute(ex.get("mono_class_from_name")?, &[image2, ns_ptr, class_ptr])?;
    if klass == 0 {
        let full = if namespace.is_empty() {
            class_name.to_string()
        } else {
            format!("{namespace}.{class_name}")
        };
        return Err(format!("class not found: {full}"));
    }

    let method_ptr = alloc_cstr(eng.mem, method)?;
    let get_method = ex.get("mono_class_get_method_from_name")?;
    let mut m = eng.execute(get_method, &[klass, method_ptr, args.len() as u64])?;
    if m == 0 {

        m = eng.execute(get_method, &[klass, method_ptr, u64::MAX])?;
    }
    if m == 0 {
        return Err(format!("method not found: {method}"));
    }

    let mut params_ptr = 0u64;
    if !args.is_empty() {
        let sn = ex
            .get("mono_string_new")
            .map_err(|_| "entry point takes arguments but mono_string_new is unavailable".to_string())?;
        let ptr_size = if eng.is64 { 8usize } else { 4 };
        let mut params = vec![0u8; args.len() * ptr_size];
        for (i, a) in args.iter().enumerate() {
            let cstr = alloc_cstr(eng.mem, a)?;
            let mstr = eng.execute(sn, &[eng.root_domain, cstr])?;
            let le = (mstr).to_le_bytes();
            params[i * ptr_size..i * ptr_size + ptr_size].copy_from_slice(&le[..ptr_size]);
        }
        params_ptr = eng.mem.allocate_and_write(&params)?;
    }

    log("→ invoking the entry point");
    let exc_ptr = eng.mem.allocate(8)?;
    eng.execute(
        ex.get("mono_runtime_invoke")?,
        &[m, 0, params_ptr, exc_ptr],
    )?;
    let exc = eng.mem.read_ptr(exc_ptr, eng.is64)?;
    if exc != 0 {
        return Err(read_exception(eng, ex, exc));
    }
    Ok(())
}

pub fn direct(
    pid: u32,
    arch_x86: bool,
    dll_path: &str,
    namespace: &str,
    class_name: &str,
    method: &str,
    args: &[String],
    timeout_ms: u32,
    log: &dyn Fn(&str),
) -> Result<(), String> {
    let is64 = !arch_x86;

    let assembly = std::fs::read(dll_path).map_err(|e| format!("read {dll_path}: {e}"))?;
    if assembly.len() < 2 || &assembly[..2] != b"MZ" {
        return Err("selected file is not a PE/.NET assembly (missing MZ header)".into());
    }

    log(&format!("→ opening process {pid}"));
    let handle: HANDLE = unsafe { th::OpenProcess(th::PROCESS_ALL_ACCESS, false, pid) }
        .map_err(|e| format!("OpenProcess({pid}): {e} — try launching ZyMono as administrator"))?;

    let result = (|| -> Result<(), String> {
        let mut mem = Memory::new(handle);
        log("→ locating the mono module and resolving exports");
        let (_base, exports) = exports::resolve(&mem, is64)?;
        log("→ resolved mono exports");
        let mut eng = Engine {
            mem: &mut mem,
            is64,
            attach: false,
            thread_attach_fn: 0,
            root_domain: 0,
            timeout_ms: timeout_ms.max(1000),
        };
        run_sequence(&mut eng, &exports, &assembly, namespace, class_name, method, args, log)
    })();

    unsafe {
        let _ = CloseHandle(handle);
    }
    result
}
