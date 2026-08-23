

use crate::{bepinex, inject, receiver, scanner};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Deserialize)]
pub struct InjectRequest {
    pub pid: u32,
    pub dll_path: String,
    pub namespace: String,
    pub class_name: String,
    pub method: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_mode")]
    pub method_mode: String,
    pub timeout_secs: Option<u32>,
    pub delay_ms: Option<u32>,
}

fn default_mode() -> String {
    "auto".into()
}

#[derive(Debug, Clone, Serialize)]
pub struct RouterProbe {
    pub bepinex_live: bool,
    pub receiver: Option<receiver::ReceiverHello>,
    pub recommended: String,
    pub reason: String,
}

pub fn probe(pid: u32) -> RouterProbe {
    let live = bepinex::is_bepinex_live(pid);
    let recv = if live {
        receiver::ping(1200).ok().flatten()
    } else {
        None
    };

    let (recommended, reason) = if !live {
        (
            "direct",
            "BepInEx isn't loaded in this process, so direct injection is safe — even for a Harmony-patching mod.".to_string(),
        )
    } else if recv.is_some() {
        (
            "pipe",
            "BepInEx is live and the receiver plugin responded — the load will be handed to it over the pipe.".to_string(),
        )
    } else {
        (
            "pipe",
            "BepInEx is live but no receiver plugin responded. Install the receiver and restart the game, or inject directly (may crash a modded game).".to_string(),
        )
    };

    RouterProbe {
        bepinex_live: live,
        receiver: recv,
        recommended: recommended.to_string(),
        reason,
    }
}

fn arch_is_x86(pid: u32) -> bool {
    scanner::scan()
        .into_iter()
        .find(|p| p.pid == pid)
        .map(|p| p.arch == "x86")
        .unwrap_or(false)
}

fn full_type(namespace: &str, class_name: &str) -> String {
    if namespace.trim().is_empty() {
        class_name.to_string()
    } else {
        format!("{namespace}.{class_name}")
    }
}

pub fn run(app: &AppHandle, req: InjectRequest) -> Result<(), String> {
    let app2 = app.clone();
    let log = move |line: &str| {
        let _ = app2.emit("zymono://log", line.to_string());
    };

    if !std::path::Path::new(&req.dll_path).is_file() {
        return Err(format!("DLL not found: {}", req.dll_path));
    }

    if let Some(ms) = req.delay_ms {
        if ms > 0 {
            log(&format!("→ waiting {ms} ms before injecting…"));
            std::thread::sleep(std::time::Duration::from_millis(ms as u64));
        }
    }

    let mode = req.method_mode.as_str();
    let live = bepinex::is_bepinex_live(req.pid);

    let use_pipe = match mode {
        "direct" => false,
        "pipe" => true,
        _ => {

            if !live {
                log("→ BepInEx is not live in this process — choosing direct injection.");
                false
            } else {
                log("→ BepInEx is live — pinging receiver plugin…");
                match receiver::ping(1500).ok().flatten() {
                    Some(h) => {
                        log(&format!("→ receiver online v{} — routing through the pipe.", h.version));
                        true
                    }
                    None => {
                        return Err("BepInEx is live but no receiver plugin responded. Install the receiver and restart the game, or choose Force Direct.".into());
                    }
                }
            }
        }
    };

    let timeout_ms = req.timeout_secs.unwrap_or(40) * 1000;

    if use_pipe {
        if mode == "pipe" {
            log("→ pinging receiver…");
            match receiver::ping(1500).ok().flatten() {
                Some(h) => log(&format!("→ receiver online v{}", h.version)),
                None => return Err("receiver plugin is not responding on the pipe".into()),
            }
        }
        let tn = full_type(&req.namespace, &req.class_name);
        log(&format!("→ sending load request: {} :: {}", tn, req.method));
        let result = receiver::load(&req.dll_path, &tn, &req.method, &req.args, timeout_ms)?;
        if result.ok {
            if let Some(rv) = result.return_value {
                if !rv.is_empty() {
                    log(&format!("→ returned: {rv}"));
                }
            }
            log("✓ receiver acknowledged — injection succeeded");
            Ok(())
        } else {
            let msg = result.exception.unwrap_or_else(|| "receiver reported failure".into());
            Err(format!("receiver load failed: {msg}"))
        }
    } else {
        let x86 = arch_is_x86(req.pid);
        inject::direct(
            req.pid,
            x86,
            &req.dll_path,
            &req.namespace,
            &req.class_name,
            &req.method,
            &req.args,
            timeout_ms,
            &log,
        )?;
        log("✓ injection succeeded");
        Ok(())
    }
}
