import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { Package, X, AlertTriangle, CheckCircle2, FolderOpen, Trash2 } from "lucide-react";
import type { ProxyPlan } from "../types";

interface Props {
  gameDir: string | null;
  defaultModPath: string | null;
  onClose: () => void;
  onToast: (kind: "ok" | "err" | "info", msg: string) => void;
}

type Prefer = "auto" | "winhttp" | "version";

export default function ProxyPanel(p: Props) {
  const [modPath, setModPath] = useState<string | null>(p.defaultModPath);
  const [prefer, setPrefer] = useState<Prefer>("auto");
  const [plan, setPlan] = useState<ProxyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const preferArg = () => (prefer === "auto" ? undefined : prefer);

  const pickMod = async () => {
    const path = await pickFile({ multiple: false, filters: [{ name: "Native DLL", extensions: ["dll"] }] });
    if (typeof path === "string") setModPath(path);
  };

  const doPreview = async () => {
    if (!p.gameDir || !modPath) return;
    setBusy(true); setErr(null); setPlan(null);
    try {
      const result = await invoke<ProxyPlan>("proxy_plan", {
        gameDir: p.gameDir, modDllPath: modPath, prefer: preferArg(),
      });
      setPlan(result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doInstall = async () => {
    if (!p.gameDir || !modPath) return;
    setBusy(true); setErr(null);
    try {
      const path = await invoke<string>("proxy_install", {
        gameDir: p.gameDir, modDllPath: modPath, prefer: preferArg(),
      });
      p.onToast("ok", `Proxy installed at ${path}`);
      p.onClose();
    } catch (e) {
      setErr(String(e));
      p.onToast("err", String(e));
    } finally {
      setBusy(false);
    }
  };

  const doUninstall = async () => {
    if (!p.gameDir || !plan) return;
    setBusy(true); setErr(null);
    try {
      await invoke("proxy_uninstall", { gameDir: p.gameDir, proxyName: plan.proxy_name });
      p.onToast("ok", `Uninstalled ${plan.proxy_name}`);
      setPlan(null);
    } catch (e) {
      setErr(String(e));
      p.onToast("err", String(e));
    } finally {
      setBusy(false);
    }
  };

  const canPreview = !!p.gameDir && !!modPath && !busy;
  const canInstall = !!plan && !busy;

  return (
    <div className="modal-overlay" onClick={p.onClose}>
      <div className="modal" style={{ width: "min(640px, 100%)", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <Package size={18} />
            <div>
              <div className="modal-title-main">Proxy preloader</div>
              <div className="modal-title-sub">Drop a winhttp / version stub next to the game exe so your mod auto-loads at launch</div>
            </div>
          </div>
          <button className="text-btn" onClick={p.onClose} title="Close"><X size={14} /></button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          <div className="field">
            <label>Game folder</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: p.gameDir ? "var(--text-dim)" : "#f0b74a", fontSize: 12.5 }}>
              <FolderOpen size={13} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.gameDir ?? "No game folder detected — select the target process first"}
              </span>
            </div>
          </div>

          <div className="field">
            <div className="field-head">
              <label>Native mod DLL</label>
              <button className="text-btn" onClick={pickMod}><FolderOpen size={13} /> Choose…</button>
            </div>
            <div style={{ fontSize: 12, color: modPath ? "var(--text-dim)" : "var(--text-faint)" }}>
              {modPath ?? "Pick the .dll that should auto-load"}
            </div>
          </div>

          <div className="field">
            <label>Proxy DLL</label>
            <div style={{ display: "inline-flex", gap: 6 }}>
              {(["auto", "winhttp", "version"] as Prefer[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setPrefer(v)}
                  className="mode-tab"
                  style={{
                    padding: "5px 10px", border: "1px solid var(--line)", borderRadius: 6,
                    background: prefer === v ? "var(--accent-soft)" : "transparent",
                    color: prefer === v ? "var(--text)" : "var(--text-dim)",
                    cursor: "pointer", fontSize: 12.5,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="field-note">Auto picks winhttp unless it's already taken.</span>
          </div>

          <div className="inject-banner" style={{ background: "rgba(240,183,74,0.06)" }}>
            <AlertTriangle size={14} />
            <div>
              <div style={{ marginBottom: 4 }}>Before you install:</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.55, color: "var(--text-dim)" }}>
                <li>Games with DRM that verifies module signatures may refuse to start.</li>
                <li>If the game already ships a mod loader (BepInEx, ReShade, Special K), it may already own this DLL slot.</li>
                <li>Multiplayer / anti-cheat games: don't use this.</li>
                <li>x86 games aren't supported yet — use LoadLibrary or Manual Map instead.</li>
              </ul>
            </div>
          </div>

          {plan && (
            <div className="dll-hint">
              <CheckCircle2 size={13} />
              <div>
                <div><strong>{plan.proxy_name}</strong> → <code>{plan.install_path}</code></div>
                <div style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 3 }}>
                  arch: {plan.arch}
                  {plan.existing_will_be_backed_up ? " · existing file will be backed up to .zymono-backup" : ""}
                </div>
              </div>
            </div>
          )}

          {err && (
            <div className="inject-banner" style={{ borderColor: "rgba(255,80,80,0.35)", background: "rgba(255,80,80,0.06)" }}>
              <AlertTriangle size={14} />
              <span>{err}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {plan && (
              <button className="secondary-btn" onClick={doUninstall} disabled={busy}>
                <Trash2 size={13} /> Uninstall
              </button>
            )}
            <button className="secondary-btn" onClick={doPreview} disabled={!canPreview}>
              Preview plan
            </button>
            <button className="inject-btn" onClick={doInstall} disabled={!canInstall} style={{ minWidth: 120 }}>
              <Package size={14} /> Install
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
