import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookMarked } from "lucide-react";
import { viewportW } from "../settings";

interface Props {
  x: number;
  y: number;
  defaultName: string;
  title?: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export default function SaveProfilePopover({ x, y, defaultName, title = "Save profile", onSave, onClose }: Props) {
  const [name, setName] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".name-popover")) onClose();
    };
    document.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => document.addEventListener("mousedown", onDown), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.clearTimeout(id);
    };
  }, [onClose]);

  const commit = () => {
    const n = name.trim();
    if (n) onSave(n);
  };

  const width = 300;
  const left = Math.max(8, Math.min(x - width, viewportW() - width - 8));
  const top = Math.max(8, y);

  return createPortal(
    <div className="name-popover" style={{ left, top, width }}>
      <div className="np-title">
        <BookMarked size={14} /> {title}
      </div>
      <input
        ref={inputRef}
        className="np-input"
        value={name}
        placeholder="Profile name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <div className="np-actions">
        <button className="text-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="np-save" disabled={!name.trim()} onClick={commit}>
          Save
        </button>
      </div>
    </div>,
    document.body
  );
}
