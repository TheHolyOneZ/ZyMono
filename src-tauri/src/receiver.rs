

use serde::{Deserialize, Serialize};

pub const PIPE_PATH: &str = r"\\.\pipe\zymono-receiver";

#[derive(Debug, Clone, Serialize)]
pub struct ReceiverHello {
    pub version: String,
    pub game: Option<String>,
    pub mono_domain_ready: bool,
}

#[derive(Debug, Clone)]
pub struct LoadResult {
    pub ok: bool,
    pub return_value: Option<String>,
    pub exception: Option<String>,
}

#[derive(Deserialize)]
struct HelloWire {
    #[serde(default)]
    version: String,
    #[serde(default)]
    game: Option<String>,
    #[serde(default)]
    mono_domain_ready: bool,
}

#[derive(Deserialize)]
struct AckWire {
    #[serde(default)]
    status: String,
    #[serde(default)]
    return_value: Option<String>,
    #[serde(default)]
    exception: Option<String>,
}

impl AckWire {
    fn ok(&self) -> bool {
        self.status == "ok"
    }
}

pub fn ping(timeout_ms: u32) -> Result<Option<ReceiverHello>, String> {
    let req = serde_json::json!({ "op": "PING" }).to_string();
    match request(&req, timeout_ms) {
        Ok(resp) => {
            let hello: HelloWire =
                serde_json::from_str(&resp).map_err(|e| format!("bad HELLO: {e}"))?;
            Ok(Some(ReceiverHello {
                version: hello.version,
                game: hello.game,
                mono_domain_ready: hello.mono_domain_ready,
            }))
        }
        Err(e) if e == NOT_PRESENT => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn load(
    dll_path: &str,
    type_name: &str,
    method: &str,
    args: &[String],
    timeout_ms: u32,
) -> Result<LoadResult, String> {
    let req = serde_json::json!({
        "op": "LOAD",
        "path": dll_path,
        "type": type_name,
        "method": method,
        "args": args,
    })
    .to_string();
    let resp = request(&req, timeout_ms).map_err(|e| {
        if e == NOT_PRESENT {
            "receiver is not running (no pipe)".to_string()
        } else {
            e
        }
    })?;
    let ack: AckWire = serde_json::from_str(&resp).map_err(|e| format!("bad ACK: {e}"))?;
    Ok(LoadResult {
        ok: ack.status == "ok",
        return_value: ack.return_value,
        exception: ack.exception,
    })
}

pub fn invoke(
    assembly_name: &str,
    type_name: &str,
    method: &str,
    args: &[String],
    timeout_ms: u32,
) -> Result<LoadResult, String> {
    let req = serde_json::json!({
        "op": "INVOKE",
        "assembly": assembly_name,
        "type": type_name,
        "method": method,
        "args": args,
    })
    .to_string();
    let resp = request(&req, timeout_ms).map_err(|e| {
        if e == NOT_PRESENT {
            "receiver is not running (no pipe)".to_string()
        } else {
            e
        }
    })?;
    let ack: AckWire = serde_json::from_str(&resp).map_err(|e| format!("bad ACK: {e}"))?;
    if !ack.ok() {
        if let Some(ex) = &ack.exception {
            if ex.contains("unknown op") {
                return Err(
                    "this game's receiver plugin is too old to unload a mod — reinstall the receiver from the Route panel and restart the game".into(),
                );
            }
        }
    }
    Ok(LoadResult {
        ok: ack.ok(),
        return_value: ack.return_value,
        exception: ack.exception,
    })
}

const NOT_PRESENT: &str = "__pipe_not_present__";

#[cfg(windows)]
fn request(payload: &str, timeout_ms: u32) -> Result<String, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, GENERIC_READ, GENERIC_WRITE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, ReadFile, WriteFile, FILE_SHARE_MODE, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES,
    };
    use windows::Win32::System::Pipes::WaitNamedPipeW;

    let wide: Vec<u16> = PIPE_PATH.encode_utf16().chain(std::iter::once(0)).collect();
    let pcw = PCWSTR(wide.as_ptr());

    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms as u64);

    unsafe {
        let handle = loop {
            match CreateFileW(
                pcw,
                (GENERIC_READ.0 | GENERIC_WRITE.0) as u32,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            ) {
                Ok(h) => break h,
                Err(e) => {
                    let code = e.code().0 as u32 & 0xFFFF;

                    if code == ERROR_FILE_NOT_FOUND.0 || code == ERROR_PIPE_BUSY.0 {
                        if code == ERROR_PIPE_BUSY.0 {
                            let _ = WaitNamedPipeW(pcw, 100);
                        }
                        if std::time::Instant::now() >= deadline {
                            return Err(NOT_PRESENT.to_string());
                        }
                        std::thread::sleep(std::time::Duration::from_millis(30));
                        continue;
                    }
                    return Err(format!("open pipe: {e}"));
                }
            }
        };

        let res = (|| -> Result<String, String> {

            let bytes = payload.as_bytes();
            let len = (bytes.len() as u32).to_le_bytes();
            let mut written = 0u32;
            WriteFile(handle, Some(&len), Some(&mut written), None).map_err(|e| format!("write len: {e}"))?;
            WriteFile(handle, Some(bytes), Some(&mut written), None).map_err(|e| format!("write body: {e}"))?;

            let mut lenbuf = [0u8; 4];
            let mut read = 0u32;
            ReadFile(handle, Some(&mut lenbuf), Some(&mut read), None).map_err(|e| format!("read len: {e}"))?;
            if read < 4 {
                return Err("short response header".into());
            }
            let rlen = u32::from_le_bytes(lenbuf) as usize;
            if rlen == 0 || rlen > 8 * 1024 * 1024 {
                return Err("bad response length".into());
            }
            let mut body = vec![0u8; rlen];
            let mut got = 0usize;
            while got < rlen {
                let mut chunk = 0u32;
                ReadFile(handle, Some(&mut body[got..]), Some(&mut chunk), None)
                    .map_err(|e| format!("read body: {e}"))?;
                if chunk == 0 {
                    break;
                }
                got += chunk as usize;
            }
            String::from_utf8(body).map_err(|e| format!("utf8: {e}"))
        })();

        let _ = CloseHandle(handle);
        res
    }
}

#[cfg(not(windows))]
fn request(_payload: &str, _timeout_ms: u32) -> Result<String, String> {
    Err(NOT_PRESENT.to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile, PIPE_ACCESS_DUPLEX};
    use windows::Win32::System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_WAIT,
    };

    fn spawn_mock_server() -> std::thread::JoinHandle<()> {
        std::thread::spawn(|| unsafe {
            let wide: Vec<u16> = PIPE_PATH.encode_utf16().chain(std::iter::once(0)).collect();
            let h: HANDLE = CreateNamedPipeW(
                PCWSTR(wide.as_ptr()),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                4096,
                4096,
                0,
                None,
            );
            assert!(!h.is_invalid(), "CreateNamedPipeW failed");
            let _ = ConnectNamedPipe(h, None);

            let mut lenbuf = [0u8; 4];
            let mut got = 0u32;
            let _ = ReadFile(h, Some(&mut lenbuf), Some(&mut got), None);
            let n = u32::from_le_bytes(lenbuf) as usize;
            if n > 0 && n < 4096 {
                let mut body = vec![0u8; n];
                let mut r = 0u32;
                let _ = ReadFile(h, Some(&mut body), Some(&mut r), None);
            }

            let hello = br#"{"op":"HELLO","version":"9.9","game":"Test","mono_domain_ready":true}"#;
            let len = (hello.len() as u32).to_le_bytes();
            let mut w = 0u32;
            let _ = WriteFile(h, Some(&len), Some(&mut w), None);
            let _ = WriteFile(h, Some(hello), Some(&mut w), None);
            let _ = CloseHandle(h);
        })
    }

    #[test]
    fn ping_round_trip() {
        let server = spawn_mock_server();

        std::thread::sleep(std::time::Duration::from_millis(300));
        let hello = ping(2000).expect("ping errored").expect("no receiver answered");
        assert_eq!(hello.version, "9.9");
        assert_eq!(hello.game.as_deref(), Some("Test"));
        assert!(hello.mono_domain_ready);
        let _ = server.join();
    }
}
