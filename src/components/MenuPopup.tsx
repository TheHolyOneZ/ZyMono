import { useEffect, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface PopItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  sep?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: PopItem[];
  onClose: () => void;
}

export default function MenuPopup({ x, y, items, onClose }: Props) {
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
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 230));
  const top = Math.max(8, Math.min(y, window.innerHeight - (items.length * 34 + 20)));

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
      {items.map((it, i) => (
        <div key={i}>
          {it.sep && <div className="ctxmenu-sep" />}
          <button className={`ctxmenu-item${it.danger ? " danger" : ""}`} onClick={act(it.onClick)}>
            {it.icon}
            {it.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
