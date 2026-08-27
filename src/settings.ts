import { invoke } from "@tauri-apps/api/core";
import { dataDir, join } from "@tauri-apps/api/path";
import type { InjectMethod } from "./types";

export type Density = "cozy" | "compact";
export type Corners = "sharp" | "rounded" | "pill";

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
  injectHotkey: string;
  highContrast: boolean;

  uiScale: number;
  density: Density;
  corners: Corners;
  windowOpacity: number;
  consoleFontSize: number;
  consoleFont: string;
  reduceMotion: boolean;
  accentGlow: boolean;
  glowStrength: number;
}

export const ACCENTS: { name: string; colors: [string, string] }[] = [
  { name: "Violet", colors: ["#a855f7", "#e879f9"] },
  { name: "Blue", colors: ["#3d9bff", "#57d6ff"] },
  { name: "Cyan", colors: ["#22d3ee", "#67e8f9"] },
  { name: "Emerald", colors: ["#10b981", "#34d399"] },
  { name: "Amber", colors: ["#f59e0b", "#fbbf24"] },
  { name: "Rose", colors: ["#f43f5e", "#fb7185"] },
];

export const CONSOLE_FONTS: { key: string; label: string; stack: string }[] = [
  { key: "mono", label: "Default", stack: `ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace` },
  { key: "consolas", label: "Consolas", stack: `Consolas, "Courier New", monospace` },
  { key: "cascadia", label: "Cascadia", stack: `"Cascadia Mono", "Cascadia Code", Consolas, monospace` },
  { key: "lucida", label: "Lucida", stack: `"Lucida Console", Consolas, monospace` },
  { key: "sans", label: "Sans", stack: `"Segoe UI", system-ui, sans-serif` },
];

export const UI_SCALE_MIN = 85;
export const UI_SCALE_MAX = 130;
export const OPACITY_MIN = 70;
export const OPACITY_MAX = 100;
export const CONSOLE_SIZE_MIN = 10;
export const CONSOLE_SIZE_MAX = 18;
export const GLOW_MIN = 25;
export const GLOW_MAX = 200;

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
  injectHotkey: "",
  highContrast: false,

  uiScale: 100,
  density: "cozy",
  corners: "rounded",
  windowOpacity: 100,
  consoleFontSize: 12,
  consoleFont: "mono",
  reduceMotion: false,
  accentGlow: true,
  glowStrength: 100,
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

function normalize(raw: Partial<Settings>): Settings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  return {
    ...s,
    uiScale: clamp(s.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, 100),
    windowOpacity: clamp(s.windowOpacity, OPACITY_MIN, OPACITY_MAX, 100),
    consoleFontSize: clamp(s.consoleFontSize, CONSOLE_SIZE_MIN, CONSOLE_SIZE_MAX, 12),
    glowStrength: clamp(s.glowStrength, GLOW_MIN, GLOW_MAX, 100),
    density: s.density === "compact" ? "compact" : "cozy",
    corners: s.corners === "sharp" || s.corners === "pill" ? s.corners : "rounded",
    consoleFont: CONSOLE_FONTS.some((f) => f.key === s.consoleFont) ? s.consoleFont : "mono",
    reduceMotion: !!s.reduceMotion,
    accentGlow: s.accentGlow !== false,
  };
}

export function loadSettings(): Settings {
  try {
    return normalize(JSON.parse(localStorage.getItem("zymono.settings") || "{}"));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem("zymono.settings", JSON.stringify(s));
  } catch {

  }
}

let cachedPath: string | null = null;
async function settingsPath(): Promise<string> {
  if (!cachedPath) cachedPath = await join(await dataDir(), "ZyMono", "settings.json");
  return cachedPath;
}

export async function loadSettingsFile(): Promise<Settings | null> {
  try {
    const text = await invoke<string>("read_text", { path: await settingsPath() });
    return normalize(JSON.parse(text));
  } catch {
    return null;
  }
}

async function writeSettingsFile(s: Settings) {
  const path = await settingsPath();
  const content = JSON.stringify(s, null, 2);
  try {
    await invoke("save_text", { path, content });
  } catch {

    try {
      await invoke("profiles_load");
      await invoke("save_text", { path, content });
    } catch {

    }
  }
}

let flushTimer: number | undefined;
let pending: Settings | null = null;

export function flushSettings() {
  if (flushTimer !== undefined) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (pending) {
    const s = pending;
    pending = null;
    void writeSettingsFile(s);
  }
}

export function persistSettings(s: Settings) {
  saveSettings(s);
  pending = s;
  if (flushTimer !== undefined) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flushSettings, 120);
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

export function applyContrast(high: boolean) {
  const root = document.documentElement;
  if (high) root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");
}

export function applyAccent([a, a2]: [string, string], glow = true, strength = 100) {
  const [r, g, b] = hexToRgb(a);
  const root = document.documentElement.style;
  const alpha = glow ? Math.max(0, Math.min(1, 0.32 * (strength / 100))) : 0;
  root.setProperty("--accent", a);
  root.setProperty("--accent-2", a2);
  root.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.12)`);
  root.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`);
  root.setProperty("--accent-faint", `rgba(${r}, ${g}, ${b}, 0.05)`);
}

export function applyAppearance(s: Settings) {
  const root = document.documentElement;
  const style = root.style;

  style.setProperty("--ui-scale", String(s.uiScale / 100));
  style.setProperty("--app-alpha", String(s.windowOpacity / 100));
  style.setProperty("--console-size", `${s.consoleFontSize}px`);
  style.setProperty(
    "--console-font",
    (CONSOLE_FONTS.find((f) => f.key === s.consoleFont) ?? CONSOLE_FONTS[0]).stack
  );

  root.setAttribute("data-density", s.density);
  root.setAttribute("data-corners", s.corners);
  if (s.reduceMotion) root.setAttribute("data-motion", "off");
  else root.removeAttribute("data-motion");
}

export function uiScaleFactor(): number {
  const v = Number(
    getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim()
  );
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export function viewportW(): number {
  return window.innerWidth / uiScaleFactor();
}

export function viewportH(): number {
  return window.innerHeight / uiScaleFactor();
}

export function toLocal(px: number): number {
  return px / uiScaleFactor();
}

export interface LocalRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function localRect(el: Element): LocalRect {
  const r = el.getBoundingClientRect();
  const k = uiScaleFactor();
  return {
    left: r.left / k,
    top: r.top / k,
    right: r.right / k,
    bottom: r.bottom / k,
    width: r.width / k,
    height: r.height / k,
  };
}
