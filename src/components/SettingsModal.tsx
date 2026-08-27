import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  X,
  FolderOpen,
  RotateCcw,
  Check,
  Github,
  Boxes,
  ExternalLink,
  SlidersHorizontal,
  Syringe,
  Palette,
  Info,
  RefreshCw,
  Download,
  Loader2,
  Sparkles,
  Home,
} from "lucide-react";
import {
  ACCENTS,
  CONSOLE_FONTS,
  DEFAULT_SETTINGS,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  OPACITY_MIN,
  OPACITY_MAX,
  CONSOLE_SIZE_MIN,
  CONSOLE_SIZE_MAX,
  GLOW_MIN,
  GLOW_MAX,
  lighten,
  type Settings,
} from "../settings";
import type { InjectMethod } from "../types";
import InfoTip from "./InfoTip";
import HotkeyInput from "./HotkeyInput";

const openUrl = (u: string) => invoke("reveal_path", { path: u }).catch(() => {});

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  appVersion: string;
  updateVersion: string | null;
  checkingUpdate: boolean;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  updateBusy: boolean;
}

type Cat = "general" | "injection" | "appearance" | "about";
const CATS: { key: Cat; label: string; icon: JSX.Element }[] = [
  { key: "general", label: "General", icon: <SlidersHorizontal size={15} /> },
  { key: "injection", label: "Injection", icon: <Syringe size={15} /> },
  { key: "appearance", label: "Appearance", icon: <Palette size={15} /> },
  { key: "about", label: "About", icon: <Info size={15} /> },
];

const REFRESH_OPTIONS = [
  { label: "1s", ms: 1000 },
  { label: "2s", ms: 2000 },
  { label: "5s", ms: 5000 },
  { label: "Off", ms: 0 },
];
const ROUTES: { key: InjectMethod; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "direct", label: "Direct" },
  { key: "pipe", label: "Pipe" },
];
const AUTOFILL: { key: Settings["profileAutofill"]; label: string }[] = [
  { key: "ask", label: "Ask" },
  { key: "auto", label: "Auto" },
  { key: "off", label: "Off" },
];
const DENSITIES: { key: Settings["density"]; label: string }[] = [
  { key: "cozy", label: "Cozy" },
  { key: "compact", label: "Compact" },
];
const CORNERS: { key: Settings["corners"]; label: string }[] = [
  { key: "sharp", label: "Sharp" },
  { key: "rounded", label: "Rounded" },
  { key: "pill", label: "Pill" },
];

export default function SettingsModal({
  settings,
  onChange,
  onClose,
  appVersion,
  updateVersion,
  checkingUpdate,
  onCheckUpdates,
  onInstallUpdate,
  updateBusy,
}: Props) {
  const [cat, setCat] = useState<Cat>("general");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFolder = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") onChange({ modFolder: dir });
  };

  const Slider = ({
    value,
    min,
    max,
    step = 1,
    unit,
    disabled,
    set,
  }: {
    value: number;
    min: number;
    max: number;
    step?: number;
    unit: string;
    disabled?: boolean;
    set: (v: number) => void;
  }) => (
    <div className="setting-row slider-row">
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
      />
      <span className="slider-value">
        {value}
        {unit}
      </span>
    </div>
  );

  const Toggle = ({ on, set }: { on: boolean; set: (v: boolean) => void }) => (
    <button className={`toggle${on ? " on" : ""}`} onClick={() => set(!on)} role="switch" aria-checked={on}>
      <span className="toggle-knob" />
    </button>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings2" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {CATS.map((c) => (
            <button
              key={c.key}
              className={`settings-nav-item${cat === c.key ? " active" : ""}`}
              onClick={() => setCat(c.key)}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
          <div className="settings-nav-foot">
            <button className="text-btn" onClick={() => onChange({ ...DEFAULT_SETTINGS })}>
              <RotateCcw size={13} /> Reset defaults
            </button>
          </div>
        </div>

        <div className="settings-main">
          <div className="settings-head2">
            <span>{CATS.find((c) => c.key === cat)?.label}</span>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)">
              <X size={15} />
            </button>
          </div>

          <div className="settings-pane">
            {cat === "general" && (
              <>
                <div className="setting">
                  <div className="setting-label">
                    Process refresh
                    <InfoTip text="How often the sidebar re-scans for running Unity/Mono games. 'Off' stops the auto-scan." />
                    <span className="setting-hint">how often the target list updates</span>
                  </div>
                  <div className="seg-choice">
                    {REFRESH_OPTIONS.map((o) => (
                      <button
                        key={o.label}
                        className={settings.refreshMs === o.ms ? "active" : ""}
                        onClick={() => onChange({ refreshMs: o.ms })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    DLL picker start folder
                    <InfoTip text="A shortcut: the folder the 'Choose .dll' browser opens in. You still pick the file yourself." />
                    <span className="setting-hint">where the file browser opens</span>
                  </div>
                  <div className="setting-row">
                    <button className="secondary-btn" onClick={pickFolder}>
                      <FolderOpen size={14} /> Choose…
                    </button>
                    <span className="setting-path" title={settings.modFolder ?? ""}>
                      {settings.modFolder ?? "System default"}
                    </span>
                    {settings.modFolder && (
                      <button className="icon-btn" title="Clear" onClick={() => onChange({ modFolder: null })}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Apply a saved profile on select
                    <InfoTip text="When you click a game that has a matching saved profile: Ask (a prompt), Auto (apply the top match silently), or Off." />
                    <span className="setting-hint">when a game has a saved profile</span>
                  </div>
                  <div className="seg-choice">
                    {AUTOFILL.map((o) => (
                      <button
                        key={o.key}
                        className={settings.profileAutofill === o.key ? "active" : ""}
                        onClick={() => onChange({ profileAutofill: o.key })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting setting-inline">
                  <div className="setting-label">
                    Auto-inject on launch
                    <InfoTip text="When ON, profiles flagged for auto-inject fire automatically as soon as their game launches (once per launch). Use the ⚡ toggle on a profile card to flag it." />
                    <span className="setting-hint">fire flagged profiles when their game starts</span>
                  </div>
                  <Toggle on={settings.autoInject} set={(v) => onChange({ autoInject: v })} />
                </div>

                <div className={`setting${settings.autoInject ? "" : " setting-disabled"}`}>
                  <div className="setting-label">
                    Auto-inject wait time
                    <InfoTip text="How long ZyMono waits after the game appears before auto-injecting, giving the runtime (and BepInEx, if used) time to finish loading. Default 5s; range 0.01–30s." />
                    <span className="setting-hint">let the game load before injecting</span>
                  </div>
                  <div className="setting-row">
                    <input
                      type="number"
                      min={0.01}
                      max={30}
                      step={0.5}
                      disabled={!settings.autoInject}
                      value={+(settings.autoInjectDelayMs / 1000).toFixed(2)}
                      onChange={(e) => {
                        const s = Math.max(0.01, Math.min(30, Number(e.target.value) || 5));
                        onChange({ autoInjectDelayMs: Math.round(s * 1000) });
                      }}
                    />
                    <span className="setting-unit">seconds</span>
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Global inject hotkey
                    <InfoTip text="A system-wide shortcut that injects the setup currently on screen — it works while the game has focus, so you don't have to alt-tab back to ZyMono. Pick something the game doesn't use." />
                    <span className="setting-hint">works while you're in the game</span>
                  </div>
                  <HotkeyInput
                    value={settings.injectHotkey}
                    onChange={(accel) => onChange({ injectHotkey: accel })}
                  />
                </div>
              </>
            )}

            {cat === "injection" && (
              <>
                <div className="setting">
                  <div className="setting-label">
                    Default route
                    <InfoTip text="The route pre-selected when you pick a target. Auto decides direct-vs-pipe from what's live in the game." />
                    <span className="setting-hint">Auto is recommended</span>
                  </div>
                  <div className="seg-choice">
                    {ROUTES.map((o) => (
                      <button
                        key={o.key}
                        className={settings.defaultRoute === o.key ? "active" : ""}
                        onClick={() => onChange({ defaultRoute: o.key })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Injection timeout
                    <InfoTip text="How long to wait for your mod's entry method before giving up." />
                    <span className="setting-hint">max wait for the entry point</span>
                  </div>
                  <div className="setting-row">
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={settings.timeoutSecs}
                      onChange={(e) =>
                        onChange({ timeoutSecs: Math.max(5, Math.min(300, Number(e.target.value) || 40)) })
                      }
                    />
                    <span className="setting-unit">seconds</span>
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Injection delay
                    <InfoTip text="Wait this long before injecting. Useful for games that need a moment to finish initializing Mono." />
                    <span className="setting-hint">pause before injecting</span>
                  </div>
                  <div className="setting-row">
                    <input
                      type="number"
                      min={0}
                      max={5000}
                      step={100}
                      value={settings.injectDelayMs}
                      onChange={(e) =>
                        onChange({ injectDelayMs: Math.max(0, Math.min(5000, Number(e.target.value) || 0)) })
                      }
                    />
                    <span className="setting-unit">ms</span>
                  </div>
                </div>

                <div className="setting setting-inline">
                  <div className="setting-label">
                    Clear console on each inject
                    <InfoTip text="Wipe the console at the start of every injection for a clean log." />
                    <span className="setting-hint">start every run with a clean log</span>
                  </div>
                  <Toggle on={settings.clearOnInject} set={(v) => onChange({ clearOnInject: v })} />
                </div>
              </>
            )}

            {cat === "appearance" && (
              <>
                <div className="setting setting-inline">
                  <div className="setting-label">
                    High contrast
                    <InfoTip text="Pure-black background, solid borders and brighter text — the same idea as GitHub's and Discord's high-contrast themes. Your accent colour is kept, just lifted so it stays readable." />
                    <span className="setting-hint">stronger borders and text, black ground</span>
                  </div>
                  <Toggle on={settings.highContrast} set={(v) => onChange({ highContrast: v })} />
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Accent color
                    <InfoTip text="Recolors the whole app — buttons, highlights, glows. Applies instantly." />
                  </div>
                  <div className="swatches">
                    {ACCENTS.map((a) => {
                      const active = !settings.customAccent && settings.accent[0] === a.colors[0];
                      return (
                        <button
                          key={a.name}
                          className={`swatch${active ? " active" : ""}`}
                          title={a.name}
                          style={{ background: `linear-gradient(135deg, ${a.colors[0]}, ${a.colors[1]})` }}
                          onClick={() => onChange({ accent: a.colors, customAccent: false })}
                        >
                          {active && <Check size={14} />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Custom accent
                    <InfoTip text="Pick any color — ZyMono derives the matching gradient automatically." />
                    <span className="setting-hint">override the presets with your own color</span>
                  </div>
                  <div className="setting-row">
                    <label className={`custom-accent${settings.customAccent ? " active" : ""}`}>
                      <span
                        className="ca-swatch"
                        style={{
                          background: `linear-gradient(135deg, ${settings.accent[0]}, ${settings.accent[1]})`,
                        }}
                      />
                      <input
                        type="color"
                        value={settings.accent[0]}
                        onChange={(e) =>
                          onChange({ accent: [e.target.value, lighten(e.target.value)], customAccent: true })
                        }
                      />
                      <span className="ca-value">{settings.accent[0].toUpperCase()}</span>
                    </label>
                  </div>
                </div>

                <div className="setting setting-inline">
                  <div className="setting-label">
                    Accent glow
                    <InfoTip text="The soft coloured halo behind buttons, the selected target and focused inputs. Turn it off for a flatter, calmer look." />
                    <span className="setting-hint">halo behind accented elements</span>
                  </div>
                  <Toggle on={settings.accentGlow} set={(v) => onChange({ accentGlow: v })} />
                </div>

                <div className={`setting${settings.accentGlow ? "" : " setting-disabled"}`}>
                  <div className="setting-label">
                    Glow strength
                    <InfoTip text="How intense the accent halo is. 100% is the ZyMono default." />
                  </div>
                  <Slider
                    value={settings.glowStrength}
                    min={GLOW_MIN}
                    max={GLOW_MAX}
                    step={5}
                    unit="%"
                    disabled={!settings.accentGlow}
                    set={(v) => onChange({ glowStrength: v })}
                  />
                </div>

                <div className="setting">
                  <div className="setting-label">
                    UI scale
                    <InfoTip text="Zooms the whole interface. Handy on 4K screens, or turn it down to fit more targets and log lines on screen." />
                    <span className="setting-hint">size of everything in the window</span>
                  </div>
                  <Slider
                    value={settings.uiScale}
                    min={UI_SCALE_MIN}
                    max={UI_SCALE_MAX}
                    step={5}
                    unit="%"
                    set={(v) => onChange({ uiScale: v })}
                  />
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Density
                    <InfoTip text="Compact tightens padding, row heights and spacing so more targets and log lines fit on screen." />
                    <span className="setting-hint">how tightly packed the layout is</span>
                  </div>
                  <div className="seg-choice">
                    {DENSITIES.map((o) => (
                      <button
                        key={o.key}
                        className={settings.density === o.key ? "active" : ""}
                        onClick={() => onChange({ density: o.key })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Corner style
                    <InfoTip text="Rounding used across the window, panels, buttons and inputs." />
                    <span className="setting-hint">from square edges to fully rounded</span>
                  </div>
                  <div className="seg-choice">
                    {CORNERS.map((o) => (
                      <button
                        key={o.key}
                        className={settings.corners === o.key ? "active" : ""}
                        onClick={() => onChange({ corners: o.key })}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Window opacity
                    <InfoTip text="Makes the ZyMono window itself see-through so you can keep an eye on the game behind it. 100% is fully solid." />
                    <span className="setting-hint">see the game through the window</span>
                  </div>
                  <Slider
                    value={settings.windowOpacity}
                    min={OPACITY_MIN}
                    max={OPACITY_MAX}
                    step={1}
                    unit="%"
                    set={(v) => onChange({ windowOpacity: v })}
                  />
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Console font
                    <InfoTip text="Typeface for the injection console. Falls back to the nearest installed font if the one you pick isn't on this machine." />
                    <span className="setting-hint">typeface for the injection log</span>
                  </div>
                  <div className="seg-choice">
                    {CONSOLE_FONTS.map((f) => (
                      <button
                        key={f.key}
                        className={settings.consoleFont === f.key ? "active" : ""}
                        style={{ fontFamily: f.stack }}
                        onClick={() => onChange({ consoleFont: f.key })}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting">
                  <div className="setting-label">
                    Console text size
                    <InfoTip text="Font size of the injection console output." />
                  </div>
                  <Slider
                    value={settings.consoleFontSize}
                    min={CONSOLE_SIZE_MIN}
                    max={CONSOLE_SIZE_MAX}
                    step={1}
                    unit="px"
                    set={(v) => onChange({ consoleFontSize: v })}
                  />
                </div>

                <div className="setting setting-inline">
                  <div className="setting-label">
                    Reduce motion
                    <InfoTip text="Turns off the fades, slides and the startup animation. Loading spinners stay, so you can still tell when ZyMono is busy." />
                    <span className="setting-hint">skip animations and transitions</span>
                  </div>
                  <Toggle on={settings.reduceMotion} set={(v) => onChange({ reduceMotion: v })} />
                </div>
              </>
            )}

            {cat === "about" && (
              <div className="setting about">
                <div className="about-head">
                  <span className="about-name">ZyMono</span>
                  <span className="beta-pill">ALPHA</span>
                  {appVersion && <span className="about-version">v{appVersion}</span>}
                </div>

                <div className="about-update">
                  {updateVersion ? (
                    <div className="au-row">
                      <span className="au-avail">
                        <Sparkles size={14} /> Version <strong>v{updateVersion}</strong> available
                      </span>
                      <button className="secondary-btn" onClick={onInstallUpdate} disabled={updateBusy}>
                        {updateBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                        Download &amp; install
                      </button>
                    </div>
                  ) : (
                    <div className="au-row">
                      <span className="au-uptodate">
                        <Check size={14} /> You're on the latest version
                      </span>
                      <button className="secondary-btn" onClick={onCheckUpdates} disabled={checkingUpdate}>
                        {checkingUpdate ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                        Check for updates
                      </button>
                    </div>
                  )}
                  <span className="au-hint">
                    Updates are downloaded from zlogic.eu and cryptographically verified before install.
                  </span>
                </div>

                <p className="about-body">
                  Windows-native Unity injector for Mono and IL2CPP games. Loads C# or C++ mods via
                  direct in-memory injection, a pipe to an in-game receiver when BepInEx or
                  MelonLoader is live, or native LoadLibrary / manual map — decided from the
                  running process and the DLL you picked, not folders on disk.
                </p>
                <dl className="about-tested">
                  <div>
                    <dt>Modes</dt>
                    <dd>Direct · Pipe (BepInEx / MelonLoader) · LoadLibrary · Manual map · Proxy</dd>
                  </div>
                  <div>
                    <dt>Targets</dt>
                    <dd>Windows · Mono &amp; IL2CPP · x86 &amp; x64</dd>
                  </div>
                </dl>
                <div className="about-made">
                  Made by <strong>TheHolyOneZ</strong>
                </div>
                <div className="about-links">
                  <button className="about-link" onClick={() => openUrl("https://zlogic.eu/zymono/")}>
                    <Home size={13} /> ZyMono home
                  </button>
                  <button className="about-link" onClick={() => openUrl("https://github.com/TheHolyOneZ/ZyMono")}>
                    <Github size={13} /> Source on GitHub
                  </button>
                  <button className="about-link" onClick={() => openUrl("https://zsync.eu/")}>
                    <Boxes size={13} /> More projects
                  </button>
                  <button className="about-link" onClick={() => openUrl("https://zlogic.eu/")}>
                    <ExternalLink size={13} /> Mods &amp; mod menus
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
