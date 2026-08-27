import { useEffect, type MouseEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { viewportH, viewportW } from "../settings";

export interface PopItem {
  label: string;
  sub?: string;
  icon?: ReactNode;
  onClick: () => void;
  onRemove?: () => void;
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

  const left = Math.max(8, Math.min(x, viewportW() - 230));
  const top = Math.max(8, Math.min(y, viewportH() - (items.length * 34 + 20)));

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
          <div className="ctxmenu-line">
            <button className={`ctxmenu-item${it.danger ? " danger" : ""}`} onClick={act(it.onClick)}>
              {it.icon}
              <span className="ctxmenu-text">
                <span className="ctxmenu-label">{it.label}</span>
                {it.sub && <span className="ctxmenu-sub">{it.sub}</span>}
              </span>
            </button>
            {it.onRemove && (
              <button
                className="ctxmenu-forget"
                title="Remove from list"
                onClick={(e) => {
                  e.stopPropagation();
                  it.onRemove!();
                  onClose();
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>,
    document.body
  );
}
