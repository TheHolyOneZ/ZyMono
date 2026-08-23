import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Boxes,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Cable,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Download,
} from "lucide-react";
import type { InjectMethod, MonoProcess, RouterProbe } from "../types";
import InfoTip from "./InfoTip";

interface Props {
  selected: MonoProcess;
  method: InjectMethod;
  onMethodChange: (m: InjectMethod) => void;
  onToast: (kind: "ok" | "err" | "info", msg: string) => void;
}

const METHODS: { key: InjectMethod; label: string; icon: JSX.Element; hint: string }[] = [
  { key: "auto", label: "Auto", icon: <ShieldCheck size={13} />, hint: "Let ZyMono decide from what's actually live in the process." },
  { key: "direct", label: "Direct", icon: <Zap size={13} />, hint: "CreateRemoteThread into the Mono runtime. Fast; can crash a BepInEx-modded game." },
  { key: "pipe", label: "Pipe", icon: <Cable size={13} />, hint: "Hand the load to the in-game receiver plugin over a named pipe. Safe with BepInEx." },
];

export default function RouterPanel({ selected, method, onMethodChange, onToast }: Props) {
  const [probe, setProbe] = useState<RouterProbe | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installTarget, setInstallTarget] = useState<string | null>(null);

  const runProbe = useCallback(async () => {
    setLoading(true);
    setInstallTarget(null);
    try {
      const p = await invoke<RouterProbe>("router_probe", { pid: selected.pid });
      setProbe(p);
    } catch (e) {
      setProbe(null);
      onToast("err", `Probe failed: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [selected.pid, onToast]);

  useEffect(() => {
    runProbe();
  }, [runProbe]);

  const previewInstall = async () => {
    setInstalling(true);
    try {
      const dest = await invoke<string>("receiver_install_target", {
        pid: selected.pid,
        gameDir: selected.game_dir ?? "",
      });
      setInstallTarget(dest);
    } catch (e) {
      onToast("err", `Couldn't resolve an install location: ${e}`);
    } finally {
      setInstalling(false);
    }
  };

  const confirmInstall = async () => {
    setInstalling(true);
    try {
      const dest = await invoke<string>("receiver_install", {
        pid: selected.pid,
        gameDir: selected.game_dir ?? "",
      });
      setInstallTarget(null);
      onToast("ok", `Receiver installed to ${dest}. Restart the game to load it.`);
    } catch (e) {
      onToast("err", `Install failed: ${e}`);
    } finally {
      setInstalling(false);
    }
  };

  const liveNoReceiver = !!probe && probe.bepinex_live && !probe.receiver;

  const statusPills = () => {
    if (!probe) {
      return (
        <span className="rs-badge muted">
          <Loader2 size={12} className="spin" /> probing…
        </span>
      );
    }
    return (
      <>
        <span className={`rs-badge ${probe.bepinex_live ? "warn" : "ok"}`}>
          {probe.bepinex_live ? <Boxes size={12} /> : <ShieldCheck size={12} />}
          BepInEx {probe.bepinex_live ? "live" : "not loaded"}
        </span>
        {probe.bepinex_live &&
          (probe.receiver ? (
            <span className="rs-badge ok">
              <ShieldCheck size={12} /> receiver v{probe.receiver.version}
            </span>
          ) : (
            <span className="rs-badge err">
              <ShieldAlert size={12} /> no receiver
            </span>
          ))}
      </>
    );
  };

  return (
    <div className="router-strip">
      <div className="rs-head">
        <span className="rs-title">
          <Boxes size={13} /> Route
          <InfoTip text="ZyMono decides direct vs pipe from what's actually LOADED in the running game — not from folders on disk. If BepInEx isn't live, direct injection works even for a Harmony-patching mod." />
        </span>
        <div className="rs-badges">{statusPills()}</div>
        <button className="rs-refresh" onClick={runProbe} disabled={loading} title="Re-check the target">
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
      </div>

      {probe && <div className="rs-reason">{probe.reason}</div>}

      {liveNoReceiver && method === "auto" && (
        <div className="router-choice">
          <div className="router-choice-msg">
            <AlertTriangle size={14} />
            <span>
              BepInEx is running but no receiver answered. Direct injection into a BepInEx-modded
              game can crash it — choose how to proceed:
            </span>
          </div>
          {installTarget ? (
            <div className="router-install-confirm">
              <div className="ric-path">
                <span className="ric-label">Install to</span>
                <code title={installTarget}>{installTarget}</code>
              </div>
              <div className="router-choice-actions">
                <button className="inject-btn sm" onClick={confirmInstall} disabled={installing}>
                  {installing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                  Confirm install
                </button>
                <button className="text-btn" onClick={() => setInstallTarget(null)} disabled={installing}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="router-choice-actions">
              <button className="secondary-btn" onClick={previewInstall} disabled={installing}>
                {installing ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                Install receiver…
              </button>
              <button className="text-btn" onClick={() => onMethodChange("direct")}>
                <Zap size={13} /> Inject directly anyway
              </button>
            </div>
          )}
        </div>
      )}

      <div className="router-methods">
        {METHODS.map((m) => (
          <button
            key={m.key}
            className={`router-method${method === m.key ? " active" : ""}`}
            onClick={() => onMethodChange(m.key)}
            title={m.hint}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
