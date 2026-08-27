import { useEffect, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Crosshair, Copy, FolderOpen, FileText } from "lucide-react";
import type { MonoProcess } from "../types";
import { viewportH, viewportW } from "../settings";

interface Props {
  proc: MonoProcess;
  x: number;
  y: number;
  onClose: () => void;
  onSelect: (p: MonoProcess) => void;
  onCopy: (text: string, label: string) => void;
  onOpenPlayerLog: () => void;
}

export default function ProcessContextMenu({
  proc,
  x,
  y,
  onClose,
  onSelect,
  onCopy,
  onOpenPlayerLog,
}: Props) {
  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
      document.addEventListener("contextmenu", onDown);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const left = Math.max(8, Math.min(x, viewportW() - 320));
  const top = Math.max(8, Math.min(y, viewportH() - 400));

  const info: [string, string | null][] = [
    ["Name", proc.name],
    ["PID", String(proc.pid)],
    ["Engine", proc.engine],
    ["Runtime", proc.flavor],
    ["Arch", proc.arch],
    ["Threads", String(proc.thread_count)],
    ["Injectable", proc.injectable ? "yes" : "no (unsupported)"],
    ["BepInEx", proc.bepinex_live ? "loaded (live)" : "not loaded"],
    ["Executable", proc.exe_path],
    ["Game dir", proc.game_dir],
    ["Mono module", proc.module_path || null],
    ["Command", proc.cmdline || null],
  ];

  const act = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
    onClose();
  };

  return createPortal(
    <div
      className="ctxmenu"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctxmenu-info">
        {info
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div className="ctxmenu-row" key={k}>
              <span className="ctxmenu-k">{k}</span>
              <span className="ctxmenu-v" title={v ?? ""}>
                {v}
              </span>
            </div>
          ))}
      </div>
      <div className="ctxmenu-sep" />
      {proc.injectable && (
        <button className="ctxmenu-item" onClick={act(() => onSelect(proc))}>
          <Crosshair size={14} /> Select as target
        </button>
      )}
      <button className="ctxmenu-item" onClick={act(() => onCopy(String(proc.pid), `PID ${proc.pid}`))}>
        <Copy size={14} /> Copy PID
      </button>
      {proc.exe_path && (
        <button className="ctxmenu-item" onClick={act(() => onCopy(proc.exe_path!, "executable path"))}>
          <FolderOpen size={14} /> Copy executable path
        </button>
      )}
      <button className="ctxmenu-item" onClick={act(onOpenPlayerLog)}>
        <FileText size={14} /> Open Player.log
      </button>
    </div>,
    document.body
  );
}
