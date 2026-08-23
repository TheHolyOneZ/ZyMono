import { Ban, ListTree, Plus, X, Puzzle, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import type { MonoProcess } from "../types";
import DllPicker from "./DllPicker";
import InfoTip from "./InfoTip";

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
}

export default function InjectForm(p: Props) {
  const notInjectable = !!p.selected && !p.selected.injectable;

  return (
    <div className="form">
      {notInjectable && (
        <div className="inject-banner">
          <Ban size={14} />
          <span>
            {p.selected!.engine === "IL2CPP" ? (
              <>
                <strong>{p.selected!.name}</strong> is an IL2CPP game — its C# is compiled to native
                code, so there's no Mono runtime to inject a managed assembly into. ZyMono injects
                into Mono/Unity games.
              </>
            ) : (
              <>
                <strong>{p.selected!.name}</strong> has no confirmed Mono runtime to inject into — it
                may be a launcher, bootstrap, or duplicate process. Pick another target on the left.
              </>
            )}
          </span>
        </div>
      )}

      <DllPicker dllPath={p.dllPath} onPick={p.onDllPick} defaultFolder={p.modFolder} />

      {p.usesHarmony && (
        <div className="dll-hint">
          <Puzzle size={13} /> This mod uses Harmony — if BepInEx is live, ZyMono routes through the
          receiver so patches apply cleanly.
        </div>
      )}

      <div className="field">
        <div className="field-head">
          <label>
            Entry point
            <InfoTip text="The static, void method ZyMono calls right after loading your DLL — e.g. MyMod.Loader.Init. Use Browse methods to pick it straight from the assembly." />
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
            placeholder="Namespace"
            value={p.namespace}
            onChange={(e) => p.onNamespaceChange(e.target.value)}
          />
          <span className="seg-div" />
          <input
            className="seg"
            type="text"
            placeholder="Class"
            value={p.className}
            onChange={(e) => p.onClassChange(e.target.value)}
          />
          <span className="seg-div" />
          <input
            className="seg"
            type="text"
            placeholder="Method"
            value={p.method}
            onChange={(e) => p.onMethodChange(e.target.value)}
          />
        </div>
        <span className="field-note">Namespace can be blank for top-level (global-namespace) types.</span>
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
            Arguments
            <InfoTip text="Optional. Each is passed to the entry method as a System.String, in order. Leave empty to call a parameterless method. Picking a method in Browse pre-fills the right number of slots." />
            <span className="label-hint">optional · passed as strings</span>
          </label>
          <button className="text-btn" onClick={() => p.onArgsChange([...p.args, ""])}>
            <Plus size={13} /> Add
          </button>
        </div>
        {p.args.length === 0 ? (
          <div className="args-empty">No arguments — calls a parameterless method.</div>
        ) : (
          <div className="args-list">
            {p.args.map((a, i) => (
              <div className="arg-row" key={i}>
                <span className="arg-idx">{i}</span>
                <input
                  type="text"
                  placeholder={`argument ${i}`}
                  value={a}
                  onChange={(e) => p.onArgsChange(p.args.map((x, j) => (j === i ? e.target.value : x)))}
                />
                <button
                  className="icon-btn"
                  title="Remove"
                  onClick={() => p.onArgsChange(p.args.filter((_, j) => j !== i))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
