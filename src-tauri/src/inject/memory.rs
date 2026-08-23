

#![allow(dead_code)]

use std::ffi::c_void;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Diagnostics::Debug as dbg;
use windows::Win32::System::Memory as mem;

pub struct Memory {
    handle: HANDLE,
    allocations: Vec<(u64, usize)>,
}

impl Memory {
    pub fn new(handle: HANDLE) -> Self {
        Memory { handle, allocations: Vec::new() }
    }

    pub fn handle(&self) -> HANDLE {
        self.handle
    }

    pub fn allocate(&mut self, size: usize) -> Result<u64, String> {
        let size = size.max(1);
        let p = unsafe {
            mem::VirtualAllocEx(
                self.handle,
                None,
                size,
                mem::MEM_COMMIT | mem::MEM_RESERVE,
                mem::PAGE_EXECUTE_READWRITE,
            )
        };
        if p.is_null() {
            return Err("VirtualAllocEx failed".into());
        }
        let addr = p as u64;
        self.allocations.push((addr, size));
        Ok(addr)
    }
}

impl Memory {
    pub fn write(&self, addr: u64, data: &[u8]) -> Result<(), String> {
        let mut written = 0usize;
        unsafe {
            dbg::WriteProcessMemory(
                self.handle,
                addr as *const c_void,
                data.as_ptr() as *const c_void,
                data.len(),
                Some(&mut written),
            )
        }
        .map_err(|e| format!("write @ {addr:#x}: {e}"))
    }

    pub fn allocate_and_write(&mut self, data: &[u8]) -> Result<u64, String> {
        let addr = self.allocate(data.len().max(1))?;
        self.write(addr, data)?;
        Ok(addr)
    }

    pub fn read_bytes(&self, addr: u64, len: usize) -> Result<Vec<u8>, String> {
        let mut buf = vec![0u8; len];
        let mut got = 0usize;
        unsafe {
            dbg::ReadProcessMemory(
                self.handle,
                addr as *const c_void,
                buf.as_mut_ptr() as *mut c_void,
                len,
                Some(&mut got),
            )
        }
        .map_err(|e| format!("read @ {addr:#x}: {e}"))?;
        buf.truncate(got);
        Ok(buf)
    }
}

impl Memory {
    pub fn read_i32(&self, addr: u64) -> Result<i32, String> {
        let b = self.read_bytes(addr, 4)?;
        if b.len() < 4 {
            return Err("short read (i32)".into());
        }
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn read_i64(&self, addr: u64) -> Result<i64, String> {
        let b = self.read_bytes(addr, 8)?;
        if b.len() < 8 {
            return Err("short read (i64)".into());
        }
        Ok(i64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]))
    }

    pub fn read_u16(&self, addr: u64) -> Result<u16, String> {
        let b = self.read_bytes(addr, 2)?;
        if b.len() < 2 {
            return Err("short read (u16)".into());
        }
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    pub fn read_ptr(&self, addr: u64, is64: bool) -> Result<u64, String> {
        if is64 {
            Ok(self.read_i64(addr)? as u64)
        } else {
            Ok(self.read_i32(addr)? as u32 as u64)
        }
    }

    pub fn read_ascii(&self, addr: u64, max: usize) -> Result<String, String> {
        let raw = self.read_bytes(addr, max)?;
        let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
        Ok(String::from_utf8_lossy(&raw[..end]).into_owned())
    }

    pub fn read_utf16(&self, addr: u64, char_len: usize) -> Result<String, String> {
        let raw = self.read_bytes(addr, char_len * 2)?;
        let units: Vec<u16> = raw
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(String::from_utf16_lossy(&units))
    }
}

impl Drop for Memory {
    fn drop(&mut self) {
        for (addr, _size) in self.allocations.drain(..) {
            unsafe {
                let _ = mem::VirtualFreeEx(self.handle, addr as *mut c_void, 0, mem::MEM_RELEASE);
            }
        }
    }
}
