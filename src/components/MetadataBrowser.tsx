import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, X, Loader2, FileCode2, Boxes } from "lucide-react";
import type { EntryPoint } from "../types";
import { basename } from "../path";

interface Props {
  dllPath: string;
  onPick: (ep: EntryPoint) => void;
  onClose: () => void;
}

export default function MetadataBrowser({ dllPath, onPick, onClose }: Props) {
  const [all, setAll] = useState<EntryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyInjectable, setOnlyInjectable] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    invoke<EntryPoint[]>("list_entry_points", { dllPath })
      .then((eps) => {
        if (!live) return;
        setAll(eps);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [dllPath]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = all.filter((ep) => {
      if (onlyInjectable && !(ep.is_static && ep.returns_void)) {
        return false;
      }
      if (!q) return true;
      const full = `${ep.namespace}.${ep.class}.${ep.method}`.toLowerCase();
      return full.includes(q);
    });
    const map = new Map<string, EntryPoint[]>();
    for (const ep of filtered) {
      const key = ep.namespace ? `${ep.namespace}.${ep.class}` : ep.class;
      (map.get(key) ?? map.set(key, []).get(key)!).push(ep);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [all, query, onlyInjectable]);

  const fileName = basename(dllPath);
  const total = groups.reduce((n, [, v]) => n + v.length, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal browser" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-title">
            <FileCode2 size={16} />
            <div>
              <div className="modal-title-main">Entry points</div>
              <div className="modal-title-sub">{fileName}</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>

        <div className="browser-controls">
          <div className="search-box">
            <Search size={14} />
            <input
              autoFocus
              type="text"
              placeholder="Search Namespace.Class.Method…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="filter-check">
            <input
              type="checkbox"
              checked={onlyInjectable}
              onChange={(e) => setOnlyInjectable(e.target.checked)}
            />
            Compatible only <span className="filter-hint">static · void</span>
          </label>
        </div>

        <div className="browser-body">
          {loading && (
            <div className="browser-state">
              <Loader2 size={20} className="spin" /> Reading assembly metadata…
            </div>
          )}
          {error && <div className="browser-state err">{error}</div>}
          {!loading && !error && total === 0 && (
            <div className="browser-state">
              No matching methods.{" "}
              {onlyInjectable && "Try turning off the compatible-only filter."}
            </div>
          )}
          {!loading &&
            !error &&
            groups.map(([cls, methods]) => (
              <div className="browser-group" key={cls}>
                <div className="browser-group-head">
                  <Boxes size={12} /> {cls}
                </div>
                {methods.map((ep, i) => {
                  const ok = ep.is_static && ep.returns_void;
                  return (
                    <button
                      key={`${ep.method}-${i}`}
                      className={`method-row${ok ? " ok" : ""}`}
                      onClick={() => onPick(ep)}
                    >
                      <span className="method-name">{ep.method}</span>
                      <span className="method-badges">
                        {ep.is_static && <span className="mb static">static</span>}
                        <span className={`mb ${ep.returns_void ? "void" : "ret"}`}>
                          {ep.returns_void ? "void" : "non-void"}
                        </span>
                        <span className={`mb ${ep.param_count === 0 ? "noargs" : "args"}`}>
                          {ep.param_count === 0 ? "()" : `${ep.param_count} arg${ep.param_count > 1 ? "s" : ""}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
        </div>

        <div className="browser-foot">
          {total} method{total === 1 ? "" : "s"} · click one to use it
        </div>
      </div>
    </div>
  );
}
