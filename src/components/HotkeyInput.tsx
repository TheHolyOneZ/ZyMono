import { useState, type KeyboardEvent } from "react";
import { Keyboard, X } from "lucide-react";

interface Props {
  value: string;
  onChange: (accel: string) => void;
}

const MOD_KEYS = ["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"];

export function prettyAccel(accel: string): string {
  if (!accel) return "";
  return accel
    .split("+")
    .map((part) => {
      if (part === "Control") return "Ctrl";
      if (part === "Super") return "Win";
      if (part.startsWith("Key")) return part.slice(3);
      if (part.startsWith("Digit")) return part.slice(5);
      if (part.startsWith("Numpad")) return `Num ${part.slice(6)}`;
      return part;
    })
    .join(" + ");
}

export default function HotkeyInput({ value, onChange }: Props) {
  const [listening, setListening] = useState(false);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      setListening(false);
      e.currentTarget.blur();
      return;
    }
    if (MOD_KEYS.includes(e.key)) return;

    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");
    if (!e.code) return;
    parts.push(e.code);

    onChange(parts.join("+"));
    setListening(false);
    e.currentTarget.blur();
  };

  return (
    <div className="hotkey-row">
      <button
        className={`hotkey-input${listening ? " listening" : ""}`}
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={onKeyDown}
      >
        <Keyboard size={13} />
        {listening ? (
          <span className="hk-listening">Press a key combination…</span>
        ) : value ? (
          <span className="hk-value">{prettyAccel(value)}</span>
        ) : (
          <span className="hk-empty">Click to set a hotkey</span>
        )}
      </button>
      {value && (
        <button className="icon-btn" title="Clear hotkey" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
