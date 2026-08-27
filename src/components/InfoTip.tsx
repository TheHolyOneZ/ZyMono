import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";
import { viewportW, localRect } from "../settings";

interface Props {
  text: string;
  size?: number;
}

export default function InfoTip({ text, size = 12 }: Props) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0, below: false });
  const ref = useRef<HTMLSpanElement>(null);

  const open = () => {
    if (!ref.current) return;
    const r = localRect(ref.current);

    const half = 140;
    const cx = Math.min(Math.max(r.left + r.width / 2, half), viewportW() - half);
    const below = r.top < 150;
    setPos({ x: cx, y: below ? r.bottom + 8 : r.top - 8, below });
    setShow(true);
  };

  return (
    <span
      className="infotip"
      ref={ref}
      tabIndex={0}
      onMouseEnter={open}
      onMouseLeave={() => setShow(false)}
      onFocus={open}
      onBlur={() => setShow(false)}
    >
      <HelpCircle size={size} />
      {show &&
        createPortal(
          <div
            className={`infotip-pop ${pos.below ? "below" : "above"}`}
            style={{ left: pos.x, top: pos.y }}
            role="tooltip"
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}
