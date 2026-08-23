import type { InjectMethod } from "./types";

export interface Settings {
  accent: [string, string];
  customAccent: boolean;
  refreshMs: number;
  modFolder: string | null;
  timeoutSecs: number;
  clearOnInject: boolean;
  injectDelayMs: number;
  defaultRoute: InjectMethod;
  profileAutofill: "ask" | "auto" | "off";
  autoInject: boolean;
  autoInjectDelayMs: number;
}

export const ACCENTS: { name: string; colors: [string, string] }[] = [
  { name: "Violet", colors: ["#a855f7", "#e879f9"] },
  { name: "Blue", colors: ["#3d9bff", "#57d6ff"] },
  { name: "Cyan", colors: ["#22d3ee", "#67e8f9"] },
  { name: "Emerald", colors: ["#10b981", "#34d399"] },
  { name: "Amber", colors: ["#f59e0b", "#fbbf24"] },
  { name: "Rose", colors: ["#f43f5e", "#fb7185"] },
];

export const DEFAULT_SETTINGS: Settings = {
  accent: ["#a855f7", "#e879f9"],
  customAccent: false,
  refreshMs: 2000,
  modFolder: null,
  timeoutSecs: 40,
  clearOnInject: true,
  injectDelayMs: 0,
  defaultRoute: "auto",
  profileAutofill: "ask",
  autoInject: false,
  autoInjectDelayMs: 5000,
};

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem("zymono.settings") || "{}");
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem("zymono.settings", JSON.stringify(s));
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

export function lighten(hex: string, amt = 0.28): string {
  const [r, g, b] = hexToRgb(hex);
  return `#${toHex(r + (255 - r) * amt)}${toHex(g + (255 - g) * amt)}${toHex(b + (255 - b) * amt)}`;
}

export function applyAccent([a, a2]: [string, string]) {
  const [r, g, b] = hexToRgb(a);
  const root = document.documentElement.style;
  root.setProperty("--accent", a);
  root.setProperty("--accent-2", a2);
  root.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.12)`);
  root.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.32)`);
  root.setProperty("--accent-faint", `rgba(${r}, ${g}, ${b}, 0.05)`);
}
