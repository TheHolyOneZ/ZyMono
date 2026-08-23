import { useEffect, useRef, useState } from "react";
import {
  Trash2,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Dot,
  Loader2,
  Circle,
  FileText,
  Copy,
  Download,
} from "lucide-react";
import { activePhases, reachedPhase } from "../phases";
import type { RunState } from "../types";
import MenuPopup from "./MenuPopup";

interface Props {
  lines: string[];
  onClear: () => void;
  runState: RunState;
  elapsed: number;
  onOpenPlayerLog: () => void;
  onCopyLog: () => void;
  onSaveLog: () => void;
}

type Kind = "ok" | "err" | "step" | "muted";

function classify(raw: string): { kind: Kind; text: string } {
  const t = raw.trim();
  if (t.startsWith("✓")) return { kind: "ok", text: t.slice(1).trim() };
  if (t.startsWith("✗")) return { kind: "err", text: t.slice(1).trim() };
  if (/(^error|error:|failed|denied)/i.test(t)) return { kind: "err", text: t };
  if (t.startsWith("→")) return { kind: "step", text: t.slice(1).trim() };
  return { kind: "muted", text: raw };
}

function LineIcon({ kind }: { kind: Kind }) {
  switch (kind) {
    case "ok":
      return <CheckCircle2 size={13} />;
    case "err":
      return <XCircle size={13} />;
    case "step":
      return <ChevronRight size={13} />;
    default:
      return <Dot size={13} />;
  }
}

function StateChip({ runState, elapsed }: { runState: RunState; elapsed: number }) {
  const secs = (elapsed / 1000).toFixed(elapsed < 10000 ? 2 : 1);
  if (runState === "running")
    return (
      <span className="chip running">
        <Loader2 size={12} className="spin" /> Injecting · {secs}s
      </span>
    );
  if (runState === "ok")
    return (
      <span className="chip ok">
        <CheckCircle2 size={12} /> Success · {secs}s
      </span>
    );
  if (runState === "err")
    return (
      <span className="chip err">
        <XCircle size={12} /> Failed · {secs}s
      </span>
    );
  return <span className="chip idle">Idle</span>;
}

export default function StatusLog({
  lines,
  onClear,
  runState,
  elapsed,
  onOpenPlayerLog,
  onCopyLog,
  onSaveLog,
}: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; line: string } | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const phases = activePhases(lines);
  const reached = reachedPhase(lines, phases);
  const showStepper = runState !== "idle" || reached >= 0;

  const phaseState = (i: number): string => {
    if (i <= reached) return "done";
    if (i === reached + 1 && runState === "running") return "active";
    if (i === reached + 1 && runState === "err") return "error";
    return "pending";
  };

  return (
    <div className="console">
      <div className="console-head">
        <div className="console-title">
          <span>Console</span>
          <StateChip runState={runState} elapsed={elapsed} />
        </div>
        <div className="console-actions">
          <button className="text-btn" onClick={onOpenPlayerLog} title="Open the game's Unity Player.log">
            <FileText size={13} /> Player.log
          </button>
          <button className="icon-btn" onClick={onCopyLog} disabled={lines.length === 0} title="Copy console to clipboard">
            <Copy size={14} />
          </button>
          <button className="icon-btn" onClick={onSaveLog} disabled={lines.length === 0} title="Save console to a file">
            <Download size={14} />
          </button>
          <button className="icon-btn" onClick={onClear} disabled={lines.length === 0} title="Clear console">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {showStepper && (
        <div className="stepper">
          {phases.map((p, i) => {
            const st = phaseState(i);
            return (
              <div key={p.key} className={`step ${st}`}>
                <span className="step-node">
                  {st === "done" ? (
                    <CheckCircle2 size={14} />
                  ) : st === "active" ? (
                    <Loader2 size={14} className="spin" />
                  ) : st === "error" ? (
                    <XCircle size={14} />
                  ) : (
                    <Circle size={14} />
                  )}
                </span>
                <span className="step-label">{p.label}</span>
                {i < phases.length - 1 && <span className="step-line" />}
              </div>
            );
          })}
        </div>
      )}

      <div className="console-scroll">
        {lines.length === 0 ? (
          <div className="console-empty">Injection output will appear here.</div>
        ) : (
          lines.map((l, i) => {
            const { kind, text } = classify(l);
            return (
              <div
                key={i}
                className={`log-line ${kind}`}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, line: text });
                }}
              >
                <span className="log-icon">
                  <LineIcon kind={kind} />
                </span>
                <span className="log-text">{text}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {menu && (
        <MenuPopup
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Copy line",
              icon: <Copy size={14} />,
              onClick: () => navigator.clipboard.writeText(menu.line).catch(() => {}),
            },
            { label: "Copy whole console", icon: <Copy size={14} />, onClick: onCopyLog },
            {
              label: "Clear console",
              icon: <Trash2 size={14} />,
              danger: true,
              sep: true,
              onClick: onClear,
            },
          ]}
        />
      )}
    </div>
  );
}
