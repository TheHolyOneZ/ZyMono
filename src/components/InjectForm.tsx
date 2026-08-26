import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import {
  Ban,
  ListTree,
  Plus,
  X,
  Puzzle,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wand2,
  Trash2,
  ListPlus,
  FolderOpen,
  ChevronUp,
  ChevronDown,
  Cpu,
  Package,
  Boxes,
} from "lucide-react";
import type { DllKind, MonoProcess, NativeMode } from "../types";
import DllPicker from "./DllPicker";
import { dirname } from "../path";
import InfoTip from "./InfoTip";
import { splitEntryPoint, normalizeEntryToken } from "../entrypoint";

type Seg = "namespace" | "class" | "method";

interface EntryStatus {
  kind: "ok" | "warn" | "err";
  msg: string;
}

interface Props {
  selected: MonoProcess | null;
  dllPath: string | null;
  onDllPick: (p: string) => void;
  modFolder: string | null;
  namespace: string;
  onNamespaceChange: (v: string) => void;
  className: string;
  onClassChange: (v: string) => void;
  method: string;
  onMethodChange: (v: string) => void;
  args: string[];
  onArgsChange: (v: string[]) => void;
  onBrowse: () => void;
  usesHarmony: boolean;
  entryStatus: EntryStatus | null;
  unloadEntry: string;
  onUnloadChange: (v: string) => void;
  expectedArgs: number | null;
  methodCount: number | null;
  dllRefs: string[];
  recent: string[];
  onRecentChange: (list: string[]) => void;
  native: boolean;
  onNativeChange: (v: boolean) => void;
  nativeMode: NativeMode;
  onNativeModeChange: (v: NativeMode) => void;
  onOpenProxy: () => void;
  dllKind: DllKind | null;

  autoRegister: boolean;
}

export default function InjectForm(p: Props) {
  const notInjectable = !!p.selected && !p.selected.injectable;
  const isIL2CPP = p.selected?.engine === "IL2CPP";
  const dllIsNative = p.dllKind?.kind === "native";
  const dllIsManaged = p.dllKind?.kind === "managed";

  const showNativeTabs = dllIsNative;

  const loader = p.selected?.mod_loader ?? null;
  const compatWarn = (() => {
    if (!p.selected || !p.dllKind) return null;
    if (isIL2CPP && dllIsManaged && !loader) {
      return "This is a C# assembly for an IL2CPP game, but no mod loader is running. Install BepInEx-IL2CPP or MelonLoader in the game folder and start the game — then install the matching ZyMono receiver from the Route panel.";
    }
    if (
      p.dllKind.arch !== "unknown" &&
      p.dllKind.arch !== "anycpu" &&
      p.dllKind.arch !== p.selected.arch
    ) {
      return `Architecture mismatch — the game is ${p.selected.arch} but this DLL is ${p.dllKind.arch}. Rebuild the mod for ${p.selected.arch}.`;
    }
    return null;
  })();

  const showIL2CPPHint = isIL2CPP && !p.dllKind && !p.dllPath;

  const pickMode = (m: NativeMode) => {
    p.onNativeChange(true);
    p.onNativeModeChange(m);
  };
  const [splitHint, setSplitHint] = useState<{ msg: string; undo: () => void } | null>(null);
  const hintTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const setSeg = (seg: Seg, v: string) => {
    if (seg === "namespace") p.onNamespaceChange(v);
    else if (seg === "class") p.onClassChange(v);
    else p.onMethodChange(v);
  };

  const setArg = (i: number, v: string) => p.onArgsChange(p.args.map((x, j) => (j === i ? v : x)));
  const addArg = () => p.onArgsChange([...p.args, ""]);
  const moveArg = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= p.args.length) return;
    const next = [...p.args];
    [next[i], next[j]] = [next[j], next[i]];
    p.onArgsChange(next);
  };

  const onArgPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const lines = e.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) return;
    e.preventDefault();
    const next = [...p.args];
    next.splice(i, 1, ...lines);
    p.onArgsChange(next);
  };

  const refChips = ["Harmony", "BepInEx", "UnityEngine"].filter((lib) =>
    p.dllRefs.some((r) => r.toLowerCase().includes(lib.toLowerCase()))
  );

  const argCountHint = (() => {
    if (p.expectedArgs == null) return null;
    if (p.expectedArgs === p.args.length) return null;
    return {
      kind: p.args.length > p.expectedArgs ? ("err" as const) : ("warn" as const),
      msg: `entry point takes ${p.expectedArgs}`,
    };
  })();

  const onSegPaste = (seg: Seg) => (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    const parts = splitEntryPoint(text);
    const before = { namespace: p.namespace, className: p.className, method: p.method };

    if (!parts) {
      const token = normalizeEntryToken(text);
      if (!token || token === text.trim()) return;
      e.preventDefault();
      setSeg(seg, token);
      return;
    }

    e.preventDefault();
    if (parts.namespace) p.onNamespaceChange(parts.namespace);
    p.onClassChange(parts.className);
    p.onMethodChange(parts.method);

    const undo = () => {
      window.clearTimeout(hintTimer.current);
      setSplitHint(null);
      p.onNamespaceChange(before.namespace);
      p.onClassChange(before.className);
      p.onMethodChange(before.method);
      setSeg(seg, text.trim());
    };

    setSplitHint({
      msg: parts.namespace
        ? `Split into ${parts.namespace} · ${parts.className} · ${parts.method}`
        : `Split into ${parts.className} · ${parts.method} — namespace left as-is`,
      undo,
    });
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setSplitHint(null), 6000);
  };

  return (
    <div className="form">
      {notInjectable && (
        <div className="inject-banner">
          <Ban size={14} />
          <span>
            <strong>{p.selected!.name}</strong> has no confirmed Mono or IL2CPP runtime to inject
            into — it may be a launcher, bootstrap, or duplicate process. Pick another target on
            the left.
          </span>
        </div>
      )}

      {compatWarn && (
        <div className="inject-banner" style={{ marginBottom: 10 }}>
          <AlertTriangle size={14} />
          <span>{compatWarn}</span>
        </div>
      )}

      {showIL2CPPHint && (
        <div className="dll-hint" style={{ marginBottom: 10 }}>
          <AlertTriangle size={14} />
          <span>
            <strong>{p.selected?.name}</strong> is IL2CPP. Pick a native C++ mod DLL to load it
            directly, or a C# DLL if you have a BepInEx-IL2CPP / MelonLoader receiver installed.
          </span>
        </div>
      )}

      {p.autoRegister && !p.native && (
        <div className="dll-hint" style={{ marginBottom: 10, borderColor: "rgba(90,220,140,0.28)", background: "rgba(90,220,140,0.06)" }}>
          <CheckCircle2 size={14} />
          <span>
            <strong>
              {p.dllKind?.has_melon_info ? "MelonMod detected" : "BepInPlugin detected"}
            </strong>
            {" — "}
            no entry point needed. The ZyMono receiver will hand this to{" "}
            {p.dllKind?.has_melon_info
              ? <code>MelonAssembly.LoadMelonAssembly</code>
              : <code>Chainloader</code>}{" "}
            and it'll register the same way as a mod loaded from disk at startup.
          </span>
        </div>
      )}

      {showNativeTabs && (
        <div className="mode-row" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div className="mode-tabs" role="tablist" aria-label="Native load mode"
               style={{ display: "inline-flex", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", padding: 3 }}>
            <button
              role="tab"
              aria-selected={p.nativeMode === "loadlibrary"}
              title="The game's own loader maps the DLL from disk"
              onClick={() => pickMode("loadlibrary")}
              className="mode-tab"
              style={{
                padding: "5px 10px", border: 0, borderRadius: 6,
                background: p.nativeMode === "loadlibrary" ? "var(--accent-soft)" : "transparent",
                color: p.nativeMode === "loadlibrary" ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5,
              }}
            >
              <Cpu size={13} /> LoadLibrary
            </button>
            <button
              role="tab"
              aria-selected={p.nativeMode === "manual_map"}
              title="Copy the DLL into the game as a memory buffer and run DllMain ourselves"
              onClick={() => pickMode("manual_map")}
              className="mode-tab"
              style={{
                padding: "5px 10px", border: 0, borderRadius: 6,
                background: p.nativeMode === "manual_map" ? "var(--accent-soft)" : "transparent",
                color: p.nativeMode === "manual_map" ? "var(--text)" : "var(--text-dim)",
                cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5,
              }}
            >
              <Boxes size={13} /> Manual Map
            </button>
          </div>
        </div>
      )}

      {isIL2CPP && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: showNativeTabs ? -6 : 0, marginBottom: 10 }}>
          <button className="text-btn" onClick={p.onOpenProxy} title="Drop a winhttp / version proxy so your mod auto-loads at game launch">
            <Package size={13} /> Proxy preloader…
          </button>
        </div>
      )}

      <div className="form-cols">
        <div className="form-col fc-dll">
          <DllPicker
            dllPath={p.dllPath}
            onPick={p.onDllPick}
            defaultFolder={p.modFolder}
            recent={p.recent}
            onRecentChange={p.onRecentChange}
          />

          {p.dllPath && (
            <div className="dll-meta">
              <div className="dm-path" title={p.dllPath}>
                <FolderOpen size={12} />
                <span>{dirname(p.dllPath)}</span>
              </div>
              {!p.native && (
                <div className="dm-chips">
                  {p.methodCount != null && (
                    <span className="dm-chip">
                      <ListTree size={11} /> {p.methodCount} method{p.methodCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {refChips.map((r) => (
                    <span className="dm-chip lib" key={r}>
                      <Puzzle size={11} /> {r}
                    </span>
                  ))}
                  {p.methodCount === 0 && (
                    <span className="dm-chip warn">
                      <AlertTriangle size={11} /> no managed methods found
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {p.usesHarmony && (
            <div className="dll-hint">
              <Puzzle size={13} /> This mod uses Harmony — if a mod loader is live, ZyMono routes
              through the ZyMono receiver so patches apply cleanly.
            </div>
          )}
        </div>

        {!p.native && !p.autoRegister && (
        <div className="form-col fc-entry">
          <div className="field">
            <div className="field-head">
              <label>
                Entry point
                <InfoTip text="The static, void method ZyMono calls right after loading your DLL — e.g. MyMod.Loader.Init. Paste the whole path into any box and it splits itself, or use Browse methods to pick it straight from the assembly." />
              </label>
              <button
                className="text-btn"
                disabled={!p.dllPath}
                onClick={p.onBrowse}
                title={p.dllPath ? "Browse methods in the DLL" : "Pick a DLL first"}
              >
                <ListTree size={13} /> Browse methods
              </button>
            </div>
            <div className="entry-group">
              <input
                className="seg"
                type="text"
                spellCheck={false}
                placeholder="Namespace"
                value={p.namespace}
                onChange={(e) => p.onNamespaceChange(e.target.value)}
                onPaste={onSegPaste("namespace")}
              />
              <span className="seg-div" />
              <input
                className="seg"
                type="text"
                spellCheck={false}
                placeholder="Class"
                value={p.className}
                onChange={(e) => p.onClassChange(e.target.value)}
                onPaste={onSegPaste("class")}
              />
              <span className="seg-div" />
              <input
                className="seg"
                type="text"
                spellCheck={false}
                placeholder="Method"
                value={p.method}
                onChange={(e) => p.onMethodChange(e.target.value)}
                onPaste={onSegPaste("method")}
              />
            </div>
            {splitHint ? (
              <span className="field-note split-note">
                <Wand2 size={12} />
                <span className="sn-msg">{splitHint.msg}</span>
                <button className="sn-undo" onClick={splitHint.undo}>
                  Undo
                </button>
              </span>
            ) : (
              <span className="field-note">
                Paste a full path like <code>RaftMod.Main.Init</code> into any box — it splits itself.
                Namespace can be blank for top-level types.
              </span>
            )}
            {p.entryStatus && (
              <span className={`entry-status ${p.entryStatus.kind}`}>
                {p.entryStatus.kind === "ok" ? (
                  <CheckCircle2 size={12} />
                ) : p.entryStatus.kind === "warn" ? (
                  <AlertTriangle size={12} />
                ) : (
                  <XCircle size={12} />
                )}
                {p.entryStatus.msg}
              </span>
            )}
          </div>

          <div className="field">
            <div className="field-head">
              <label>
                Unload entry point
                <InfoTip text="Optional. A static, void method that tears your mod down again — e.g. MyMod.Loader.Unload. Fill it in and an Eject button appears next to Inject, so you can reload a mod without restarting the game. ZyMono calls it on the copy of your assembly that is already live, so its statics are the ones you set up in Init." />
                <span className="label-hint">optional</span>
              </label>
              {p.unloadEntry && (
                <button className="text-btn" onClick={() => p.onUnloadChange("")}>
                  <X size={13} /> Clear
                </button>
              )}
            </div>
            <input
              type="text"
              spellCheck={false}
              placeholder="MyMod.Loader.Unload"
              value={p.unloadEntry}
              onChange={(e) => p.onUnloadChange(e.target.value)}
            />
            <span className="field-note">
              Leave blank if your mod can't unload itself — most can't.
            </span>
          </div>
        </div>

        )}
        {!p.native && !p.autoRegister && (
        <div className="form-col fc-args">
          <div className="field args-field">
            <div className="field-head">
              <label>
                Arguments
                <InfoTip text="Optional. Each is passed to the entry method as a System.String, in order. Leave empty to call a parameterless method. Picking a method in Browse pre-fills the right number of slots, and pasting several lines at once creates one argument per line." />
                {p.args.length > 0 && <span className="args-count">{p.args.length}</span>}
                {argCountHint && (
                  <span className={`args-expect ${argCountHint.kind}`}>{argCountHint.msg}</span>
                )}
              </label>
              {p.args.length > 0 && (
                <button className="text-btn" onClick={() => p.onArgsChange([])} title="Remove every argument">
                  <Trash2 size={13} /> Clear
                </button>
              )}
            </div>

            {p.args.length === 0 ? (
              <div className="args-empty">
                <ListPlus size={22} strokeWidth={1.6} />
                <span className="ae-title">No arguments</span>
                <span className="ae-sub">
                  ZyMono will call a parameterless method. Add one for each parameter your entry
                  point takes — every value is passed as a <code>string</code>.
                </span>
                <button className="secondary-btn" onClick={addArg}>
                  <Plus size={14} /> Add argument
                </button>
              </div>
            ) : (
              <>
                <div className="args-list">
                  {p.args.map((a, i) => (
                    <div className="arg-row" key={i}>
                      <span className="arg-idx" title={`argument ${i}`}>
                        {i}
                      </span>
                      <input
                        type="text"
                        spellCheck={false}
                        placeholder={`value for argument ${i}`}
                        value={a}
                        onChange={(e) => setArg(i, e.target.value)}
                        onPaste={(e) => onArgPaste(i, e)}
                      />
                      <div className="arg-tools">
                        <button
                          className="arg-btn"
                          title="Move up"
                          disabled={i === 0}
                          onClick={() => moveArg(i, -1)}
                        >
                          <ChevronUp size={13} />
                        </button>
                        <button
                          className="arg-btn"
                          title="Move down"
                          disabled={i === p.args.length - 1}
                          onClick={() => moveArg(i, 1)}
                        >
                          <ChevronDown size={13} />
                        </button>
                        <button
                          className="arg-btn danger"
                          title="Remove"
                          onClick={() => p.onArgsChange(p.args.filter((_, j) => j !== i))}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button className="args-add" onClick={addArg}>
                  <Plus size={14} /> Add argument
                </button>
              </>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
