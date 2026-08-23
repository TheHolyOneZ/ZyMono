import { useEffect, useState, useCallback, useRef, useMemo, memo, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Cpu, SearchX, AlertTriangle, Boxes, Search, X } from "lucide-react";
import type { MonoProcess } from "../types";
import InfoTip from "./InfoTip";

interface RowProps {
  proc: MonoProcess;
  selected: boolean;
  onSelect: (p: MonoProcess) => void;
  onContext: (p: MonoProcess, e: MouseEvent) => void;
}

const Row = memo(
  function Row({ proc, selected, onSelect, onContext }: RowProps) {
    return (
      <button
        className={`proc-row${selected ? " selected" : ""}`}
        onClick={() => onSelect(proc)}
        onContextMenu={(e) => onContext(proc, e)}
      >
        <span className="proc-bar" />
        <div className="proc-body">
          <div className="proc-line">
            <span className="proc-name">{proc.name}</span>
            <span className="proc-pid">{proc.pid}</span>
          </div>
          <div className="proc-flavor">
            <Cpu size={11} className="flavor-icon" />
            <span className="flavor-text">{proc.flavor}</span>
            <span className="proc-threads">{proc.thread_count} thr</span>
            <span className="proc-arch">{proc.arch}</span>
            {proc.bepinex_live && (
              <span className="proc-badge bepinex" title="BepInEx is actually loaded in this process — injection will route through the receiver plugin if one is live.">
                <Boxes size={10} /> BepInEx
              </span>
            )}
            {proc.duplicate && (
              <span className="proc-badge dup" title="Another PID of this game has more threads — likely the real one">
                dup
              </span>
            )}
            {proc.suspect && proc.injectable && !proc.duplicate && (
              <span className="proc-badge warn" title="No confirmed Mono runtime — may not be the live game">
                <AlertTriangle size={10} /> suspect
              </span>
            )}
            {proc.engine === "IL2CPP" && (
              <span className="proc-badge il2cpp" title="IL2CPP game — compiled to native code, no Mono runtime to inject into. ZyMono can't inject managed assemblies here.">
                IL2CPP
              </span>
            )}
          </div>
        </div>
      </button>
    );
  },
  (a, b) =>
    a.selected === b.selected &&
    a.onSelect === b.onSelect &&
    a.onContext === b.onContext &&
    a.proc.pid === b.proc.pid &&
    a.proc.name === b.proc.name &&
    a.proc.flavor === b.proc.flavor &&
    a.proc.thread_count === b.proc.thread_count &&
    a.proc.injectable === b.proc.injectable &&
    a.proc.suspect === b.proc.suspect &&
    a.proc.duplicate === b.proc.duplicate &&
    a.proc.arch === b.proc.arch &&
    a.proc.bepinex_live === b.proc.bepinex_live &&
    a.proc.engine === b.proc.engine
);

interface Props {
  selectedPid: number | null;
  onSelect: (proc: MonoProcess) => void;
  onContext: (proc: MonoProcess, e: MouseEvent) => void;
  onList?: (procs: MonoProcess[]) => void;
  onSearchFocus?: () => void;
  refreshMs: number;
}

const matches = (p: MonoProcess, q: string) =>
  p.name.toLowerCase().includes(q) ||
  String(p.pid).includes(q) ||
  p.flavor.toLowerCase().includes(q) ||
  p.engine.toLowerCase().includes(q) ||
  (p.exe_path ?? "").toLowerCase().includes(q) ||
  (p.game_dir ?? "").toLowerCase().includes(q);

export default function ProcessList({
  selectedPid,
  onSelect,
  onContext,
  onList,
  onSearchFocus,
  refreshMs,
}: Props) {
  const [procs, setProcs] = useState<MonoProcess[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [query, setQuery] = useState("");
  const lastKey = useRef("");
  const onListRef = useRef(onList);
  onListRef.current = onList;
  const onSearchFocusRef = useRef(onSearchFocus);
  onSearchFocusRef.current = onSearchFocus;
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (manual = false) => {
    if (manual) setSpinning(true);
    try {
      const list = await invoke<MonoProcess[]>("list_mono_processes");
      const key = JSON.stringify(list);
      if (key !== lastKey.current) {
        lastKey.current = key;
        setProcs(list);
      }
      setError(null);
      onListRef.current?.(list);
    } catch (e) {
      setError(String(e));
    } finally {
      if (manual) setSpinning(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    if (refreshMs <= 0) return;
    const id = setInterval(() => refresh(false), refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      onSearchFocusRef.current?.();
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? procs.filter((p) => matches(p, q)) : procs), [procs, q]);

  return (
    <div className="sidebar-inner">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <span>Targets</span>
          <InfoTip text="Running Unity/Mono games, auto-refreshed. IL2CPP games show as non-injectable. A 'BepInEx' badge means the loader is actually live in that process. Right-click for full details." />
          <span className="count">{q ? `${shown.length}/${procs.length}` : procs.length}</span>
        </div>
        <button className="icon-btn" onClick={() => refresh(true)} disabled={spinning} title="Refresh">
          <RefreshCw size={14} className={spinning ? "spin" : ""} />
        </button>
      </div>

      <div className="target-search">
        <Search size={13} />
        <input
          ref={searchRef}
          type="text"
          spellCheck={false}
          placeholder="Filter targets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (query) setQuery("");
              else e.currentTarget.blur();
            }
          }}
        />
        {query ? (
          <button className="ts-clear" title="Clear filter" onClick={() => setQuery("")}>
            <X size={12} />
          </button>
        ) : (
          <span className="ts-kbd">Ctrl F</span>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="proc-scroll">
        {procs.length === 0 && !error && (
          <div className="empty-hint">
            <SearchX size={24} strokeWidth={1.6} />
            <span>No Mono / Unity games running</span>
            <small>Launch one and it appears here.</small>
          </div>
        )}
        {procs.length > 0 && shown.length === 0 && (
          <div className="empty-hint">
            <SearchX size={24} strokeWidth={1.6} />
            <span>No target matches "{query.trim()}"</span>
            <button className="text-btn" onClick={() => setQuery("")}>
              Clear filter
            </button>
          </div>
        )}
        {shown.map((p) => (
          <Row
            key={p.pid}
            proc={p}
            selected={selectedPid === p.pid}
            onSelect={onSelect}
            onContext={onContext}
          />
        ))}
      </div>
    </div>
  );
}
