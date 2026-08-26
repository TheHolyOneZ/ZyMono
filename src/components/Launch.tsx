import { useCallback, useEffect, useRef, useState } from "react";
import "./Launch.css";

interface Props {
  onDone: () => void;
}

const Z_PATH =
  "M 142 100 L 362 100 L 362 154 L 210 346 L 362 346 L 362 400 " +
  "L 142 400 L 142 346 L 294 154 L 142 154 Z";

const SYRINGE_TF = "translate(256 256) rotate(-45) scale(0.84) translate(-10 -40)";

const TIP_X = 76.6;
const TIP_Y = 387.9;

const TICKS = [-56, -28, 0, 28, 56, 84];

const MOTES = [
  { x: 12, y: 78, s: 2.5, d: 0.2, t: 7.5 },
  { x: 22, y: 34, s: 1.6, d: 1.4, t: 9.0 },
  { x: 31, y: 88, s: 2.0, d: 0.7, t: 8.2 },
  { x: 44, y: 18, s: 1.4, d: 2.1, t: 10.5 },
  { x: 57, y: 66, s: 2.8, d: 0.0, t: 7.0 },
  { x: 66, y: 26, s: 1.8, d: 1.7, t: 9.6 },
  { x: 73, y: 92, s: 2.2, d: 0.9, t: 8.8 },
  { x: 84, y: 44, s: 1.5, d: 2.4, t: 11.0 },
  { x: 91, y: 72, s: 2.4, d: 0.5, t: 7.8 },
  { x: 7, y: 52, s: 1.7, d: 1.9, t: 10.0 },
  { x: 38, y: 58, s: 1.3, d: 3.0, t: 9.2 },
  { x: 52, y: 96, s: 2.1, d: 1.2, t: 8.4 },
  { x: 79, y: 12, s: 1.9, d: 2.7, t: 10.8 },
  { x: 96, y: 30, s: 1.5, d: 0.4, t: 8.0 },
];

export function Launch({ onDone }: Props) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || (window as never as { __zymonoNoLaunch?: boolean }).__zymonoNoLaunch) {
      finish();
      return;
    }

    const leave = window.setTimeout(() => setLeaving(true), 4350);
    const failsafe = window.setTimeout(finish, 5200);
    const skip = () => setLeaving(true);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(failsafe);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [finish]);

  return (
    <div
      className={`lx${leaving ? " lx-out" : ""}`}
      onTransitionEnd={(e) => {
        if (leaving && e.propertyName === "opacity") finish();
      }}
      aria-hidden="true"
    >
      <div className="lx-void" />
      <div className="lx-aurora" />
      <div className="lx-motes">
        {MOTES.map((m, i) => (
          <span
            key={i}
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: `${m.s}px`,
              height: `${m.s}px`,
              animationDelay: `${m.d}s`,
              animationDuration: `${m.t}s`,
            }}
          />
        ))}
      </div>

      <div className="lx-scene">
        <div className="lx-icon">
          <div className="lx-halo" />
          <div className="lx-streak" />
          <svg className="lx-svg" viewBox="0 0 512 512" aria-hidden="true">
            <defs>

              <linearGradient id="lxTile" x1="0.1" y1="0" x2="0.85" y2="1">
                <stop offset="0%" stopColor="#16233a" />
                <stop offset="38%" stopColor="#0b1322" />
                <stop offset="100%" stopColor="#04070e" />
              </linearGradient>

              <radialGradient id="lxTileGlow" cx="0.5" cy="0.44" r="0.62">
                <stop offset="0%" stopColor="#2f8fff" stopOpacity="0.20" />
                <stop offset="55%" stopColor="#1b5fd0" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0" />
              </radialGradient>

              <linearGradient id="lxRim" x1="0.2" y1="0" x2="0.8" y2="1">
                <stop offset="0%" stopColor="#cfe8ff" stopOpacity="0.62" />
                <stop offset="30%" stopColor="#7fb4ee" stopOpacity="0.20" />
                <stop offset="70%" stopColor="#3f6fbe" stopOpacity="0.10" />
                <stop offset="100%" stopColor="#8fc6ff" stopOpacity="0.34" />
              </linearGradient>

              <linearGradient
                id="lxEdge"
                gradientUnits="userSpaceOnUse"
                x1="120"
                y1="80"
                x2="410"
                y2="440"
              >
                <stop offset="0%" stopColor="#a6f3ff" />
                <stop offset="24%" stopColor="#48d2ff" />
                <stop offset="54%" stopColor="#1a86f0" />
                <stop offset="80%" stopColor="#2fb6ff" />
                <stop offset="100%" stopColor="#86e9ff" />
              </linearGradient>

              <linearGradient id="lxGlass" x1="0" y1="0" x2="0.6" y2="1">
                <stop offset="0%" stopColor="#101d33" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#050a14" stopOpacity="0.88" />
              </linearGradient>

              <linearGradient id="lxFluid" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8bf0ff" stopOpacity="0.90" />
                <stop offset="100%" stopColor="#2f8fff" stopOpacity="0.55" />
              </linearGradient>

              <linearGradient id="lxGloss" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="45%" stopColor="#ffffff" stopOpacity="0.13" />
                <stop offset="55%" stopColor="#dff4ff" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </linearGradient>

              <radialGradient id="lxFlash">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="30%" stopColor="#9fe8ff" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#2f8fff" stopOpacity="0" />
              </radialGradient>

              <filter id="lxNeon" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="6" result="b" />
                <feColorMatrix
                  in="b"
                  type="matrix"
                  values="0 0 0 0 0.22  0 0 0 0 0.72  0 0 0 0 1  0 0 0 0.85 0"
                  result="c"
                />
                <feMerge>
                  <feMergeNode in="c" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <clipPath id="lxTileClip">
                <rect x="26" y="26" width="460" height="460" rx="116" />
              </clipPath>

              <g id="lxSil">
                <path d="M -126 -8 L -238 -1.5 L -252 0 L -238 1.5 L -126 8 Z" />
                <path d="M -126 -10 L -98 -26 L -98 26 L -126 10 Z" />
                <rect x="-98" y="-38" width="250" height="76" rx="16" />
                <rect x="146" y="-64" width="26" height="128" rx="9" />
                <rect x="176" y="-15" width="78" height="30" rx="8" />
                <rect x="248" y="-52" width="26" height="104" rx="9" />
              </g>

              <mask id="lxZMask">
                <rect x="0" y="0" width="512" height="512" fill="#fff" />
                <g transform={SYRINGE_TF}>
                  <use
                    href="#lxSil"
                    fill="#000"
                    stroke="#000"
                    strokeWidth="30"
                    strokeLinejoin="round"
                  />
                </g>
              </mask>
            </defs>

            <g className="lx-tile">
              <rect x="26" y="26" width="460" height="460" rx="116" fill="url(#lxTile)" />
              <rect
                className="lx-tile-glow"
                x="26"
                y="26"
                width="460"
                height="460"
                rx="116"
                fill="url(#lxTileGlow)"
              />
              <rect
                className="lx-rim"
                x="27.5"
                y="27.5"
                width="457"
                height="457"
                rx="114.5"
                fill="none"
                stroke="url(#lxRim)"
                strokeWidth="3"
                pathLength="100"
              />
            </g>

            <g className="lx-mark" filter="url(#lxNeon)">

              <g mask="url(#lxZMask)">
                <path className="lx-z-fill" d={Z_PATH} fill="url(#lxGlass)" />
                <path
                  className="lx-z-line"
                  d={Z_PATH}
                  fill="none"
                  stroke="url(#lxEdge)"
                  strokeWidth="11"
                  strokeLinejoin="round"
                  pathLength="100"
                />

                <path
                  className="lx-z-spark"
                  d={Z_PATH}
                  fill="none"
                  stroke="#eafcff"
                  strokeWidth="13"
                  strokeLinecap="round"
                  pathLength="100"
                />
              </g>

              <g transform={SYRINGE_TF}>

                <path
                  className="lx-part lx-s1"
                  d="M -126 -8 L -238 -1.5 L -252 0 L -238 1.5 L -126 8 Z"
                  fill="url(#lxGlass)"
                  stroke="url(#lxEdge)"
                  strokeWidth="8"
                  strokeLinejoin="round"
                  pathLength="100"
                />

                <path
                  className="lx-part lx-s2"
                  d="M -126 -10 L -98 -26 L -98 26 L -126 10 Z"
                  fill="url(#lxGlass)"
                  stroke="url(#lxEdge)"
                  strokeWidth="9"
                  strokeLinejoin="round"
                  pathLength="100"
                />

                <rect
                  className="lx-part lx-s3"
                  x="-98"
                  y="-38"
                  width="250"
                  height="76"
                  rx="16"
                  fill="url(#lxGlass)"
                  stroke="url(#lxEdge)"
                  strokeWidth="11"
                  pathLength="100"
                />

                <rect
                  className="lx-fluid"
                  x="-92"
                  y="-28"
                  width="142"
                  height="56"
                  rx="12"
                  fill="url(#lxFluid)"
                />

                <rect
                  className="lx-plunger"
                  x="50"
                  y="-24"
                  width="102"
                  height="48"
                  rx="10"
                  fill="#0c1728"
                />

                <g
                  className="lx-part lx-s4"
                  stroke="url(#lxEdge)"
                  strokeWidth="6"
                  strokeLinecap="round"
                >
                  {TICKS.map((tx) => (
                    <line key={tx} x1={tx} y1="-38" x2={tx} y2="-16" />
                  ))}
                </g>

                <rect
                  className="lx-part lx-s5"
                  x="146"
                  y="-64"
                  width="26"
                  height="128"
                  rx="9"
                  fill="url(#lxGlass)"
                  stroke="url(#lxEdge)"
                  strokeWidth="10"
                  pathLength="100"
                />

                <rect
                  className="lx-rod"
                  x="176"
                  y="-15"
                  width="78"
                  height="30"
                  rx="8"
                  fill="url(#lxGlass)"
                  stroke="url(#lxEdge)"
                  strokeWidth="9"
                  pathLength="100"
                />

                <rect
                  className="lx-cap"
                  x="248"
                  y="-52"
                  width="26"
                  height="104"
                  rx="9"
                  fill="url(#lxGlass)"
                  stroke="url(#lxEdge)"
                  strokeWidth="10"
                  pathLength="100"
                />
              </g>
            </g>

            <g clipPath="url(#lxTileClip)">
              <circle className="lx-flash" cx={TIP_X} cy={TIP_Y} r="150" fill="url(#lxFlash)" />
              <circle
                className="lx-wave lx-w1"
                cx={TIP_X}
                cy={TIP_Y}
                r="30"
                fill="none"
                stroke="#9fe8ff"
                strokeWidth="3"
              />
              <circle
                className="lx-wave lx-w2"
                cx={TIP_X}
                cy={TIP_Y}
                r="30"
                fill="none"
                stroke="#4fc4ff"
                strokeWidth="2"
              />

              <g transform="rotate(18 256 256)">
                <rect
                  className="lx-gloss"
                  x="-300"
                  y="-120"
                  width="230"
                  height="760"
                  fill="url(#lxGloss)"
                />
              </g>
            </g>
          </svg>
        </div>
      </div>

      <div className="lx-tunnel" />
      <div className="lx-punch" />

      <svg className="lx-wm" viewBox="0 0 512 512" aria-hidden="true">
        <defs>
          <linearGradient id="lxWm" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0%" stopColor="#7fd8ff" />
            <stop offset="55%" stopColor="#2f8fff" />
            <stop offset="100%" stopColor="#6fe0ff" />
          </linearGradient>
        </defs>
        <path d={Z_PATH} fill="none" stroke="url(#lxWm)" strokeWidth="9" strokeLinejoin="round" />
      </svg>

      <div className="lx-card">
        <div className="lx-word">
          <span className="lx-word-flare" />
          <span className="lx-word-text">ZyMono</span>
        </div>
        <p className="lx-sub">Inject the smart way</p>

        <div className="lx-div">
          <span className="lx-div-line" />
          <i className="lx-div-gem" />
        </div>

        <p className="lx-brand">
          <span className="lx-brand-by">By</span>
          <span className="lx-brand-name">TheHolyOneZ</span>
        </p>
      </div>

      <div className="lx-grain" />

      <div className="lx-skip">
        <i />
        Click anywhere to skip
      </div>
    </div>
  );
}

export default Launch;
