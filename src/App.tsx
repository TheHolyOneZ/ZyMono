import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { save, open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import {
  Copy,
  CheckCircle2,
  XCircle,
  X,
  Syringe,
  Ban,
  ChevronDown,
  BookMarked,
  Sparkles,
  Download,
  Eraser,
  FileCode2,
} from "lucide-react";
import type { DllKind, EntryPoint, InjectMethod, MonoProcess, NativeMode, Profile, RunState } from "./types";
import { checkForUpdate, installUpdate, type UpdateInfo } from "./updater";
import TitleBar from "./components/TitleBar";
import ProcessList from "./components/ProcessList";
import ProfilesList from "./components/ProfilesList";
import InjectForm from "./components/InjectForm";
import RouterPanel from "./components/RouterPanel";
import ProxyPanel from "./components/ProxyPanel";
import { Launch } from "./components/Launch";
import StatusLog from "./components/StatusLog";
import MetadataBrowser from "./components/MetadataBrowser";
import InfoTip from "./components/InfoTip";
import ProcessContextMenu from "./components/ProcessContextMenu";
import SettingsModal from "./components/SettingsModal";
import SaveProfilePopover from "./components/SaveProfilePopover";
import MenuPopup from "./components/MenuPopup";
import ResizeHandles from "./components/ResizeHandles";
import {
  loadSettings,
  loadSettingsFile,
  persistSettings,
  saveSettings,
  flushSettings,
  applyAccent,
  applyContrast,
  applyAppearance,
  viewportH,
  toLocal,
  localRect,
  type Settings,
} from "./settings";
import {
  parseProfiles,
  migrateFromLocalStorage,
  upsert,
  remove,
  duplicate,
  matchTarget,
  sortProfiles,
  suggestName,
  newId,
} from "./profiles";
import { basename } from "./path";
import { loadRecentDlls, pushRecentDll } from "./recent";
import { splitEntryPoint } from "./entrypoint";

interface InjectCfg {
  dllPath: string | null;
  namespace: string;
  className: string;
  method: string;
  args: string[];
  methodMode: InjectMethod;
  invokeOnly?: boolean;
  native?: boolean;
  nativeMode?: NativeMode;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const CONSOLE_H_KEY = "zymono.consoleH3";

const numPref = (k: string, d: number) => {
  const v = Number(localStorage.getItem(k));
  return Number.isFinite(v) && v > 0 ? v : d;
};

interface Preset {
  dll: string | null;
  namespace: string;
  className: string;
  method: string;
  args?: string[];
  unload?: string;
}
const loadPresets = (): Record<string, Preset> => {
  try {
    return JSON.parse(localStorage.getItem("zymono.presets") || "{}");
  } catch {
    return {};
  }
};
const savePreset = (key: string, p: Preset) => {
  if (!key) return;
  const all = loadPresets();
  all[key] = p;
  localStorage.setItem("zymono.presets", JSON.stringify(all));
};

export default function App() {
  const [selected, setSelected] = useState<MonoProcess | null>(null);
  const [dllPath, setDllPath] = useState<string | null>(null);
  const [namespace, setNamespace] = useState("");
  const [className, setClassName] = useState("");
  const [method, setMethod] = useState("");
  const [unloadEntry, setUnloadEntry] = useState("");
  const [args, setArgs] = useState<string[]>([]);
  const [recentDlls, setRecentDlls] = useState<string[]>(loadRecentDlls);
  const [injectMethod, setInjectMethod] = useState<InjectMethod>(() => loadSettings().defaultRoute);
  const [native, setNative] = useState(false);
  const [nativeMode, setNativeMode] = useState<NativeMode>("loadlibrary");
  const [proxyOpen, setProxyOpen] = useState(false);
  const [dllKind, setDllKind] = useState<DllKind | null>(null);

  const [splash, setSplash] = useState(() => !(window as unknown as { __zymonoSplashDone?: boolean }).__zymonoSplashDone);
  const [dllEntries, setDllEntries] = useState<EntryPoint[] | null>(null);
  const [dllRefs, setDllRefs] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [drag, setDrag] = useState<{ name: string; count: number; ok: boolean } | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err" | "info"; msg: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; proc: MonoProcess } | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [appVersion, setAppVersion] = useState("");
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updatePct, setUpdatePct] = useState<number | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem("zymono.guideDismissed") !== "1");
  const startedAt = useRef(0);

  const [sidebarTab, setSidebarTab] = useState<"targets" | "profiles">("targets");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [targets, setTargets] = useState<MonoProcess[]>([]);
  const targetsRef = useRef<MonoProcess[]>([]);
  const suppressPreset = useRef(false);
  const [savePop, setSavePop] = useState<{ x: number; y: number } | null>(null);
  const [saveMenu, setSaveMenu] = useState<{ x: number; y: number } | null>(null);
  const [profilePrompt, setProfilePrompt] = useState<Profile | null>(null);

  const formRef = useRef({ dllPath, namespace, className, method });
  formRef.current = { dllPath, namespace, className, method };

  const pickDll = useCallback((path: string) => {
    setDllPath(path);
    setRecentDlls(pushRecentDll(path));
  }, []);

  const profilesRef = useRef<Profile[]>(profiles);
  profilesRef.current = profiles;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;
  const autoInjectedPids = useRef<Set<number>>(new Set());
  const scheduledAuto = useRef<Set<number>>(new Set());
  const runInjectionRef = useRef<(t: MonoProcess, cfg: InjectCfg) => void>(() => {});

  const persistProfiles = useCallback((list: Profile[]) => {
    setProfiles(list);
    invoke("profiles_save", { json: JSON.stringify(list) }).catch((e) =>
      setToast({ kind: "err", msg: `Couldn't save profiles: ${e}` })
    );
  }, []);
  useEffect(() => {
    let live = true;
    invoke<string>("profiles_load")
      .then((json) => {
        if (!live) return;
        let list = parseProfiles(json);
        if (list.length === 0) {
          const migrated = migrateFromLocalStorage();
          if (migrated.length) {
            list = migrated;
            invoke("profiles_save", { json: JSON.stringify(list) }).catch(() => {});
          }
        }
        setProfiles(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const configRef = useRef<HTMLDivElement>(null);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [hintOn, setHintOn] = useState(false);
  const hintTimer = useRef<number | undefined>(undefined);
  const hintArmed = useRef(true);
  const updateScroll = useCallback(() => {
    const el = configRef.current;
    if (!el) return;
    const more = el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    const atTop = el.scrollTop < 6;
    setCanScrollDown(more);
    if (!atTop) {

      hintArmed.current = true;
      setHintOn(false);
    } else if (more && hintArmed.current) {

      hintArmed.current = false;
      setHintOn(true);
      window.clearTimeout(hintTimer.current);
      hintTimer.current = window.setTimeout(() => setHintOn(false), 2600);
    }
  }, []);

  const dismissGuide = () => {
    setShowGuide(false);
    localStorage.setItem("zymono.guideDismissed", "1");
  };

  useEffect(
    () => applyAccent(settings.accent, settings.accentGlow, settings.glowStrength),
    [settings.accent, settings.accentGlow, settings.glowStrength]
  );
  useEffect(() => applyContrast(settings.highContrast), [settings.highContrast]);
  useEffect(() => applyAppearance(settings), [
    settings.uiScale,
    settings.density,
    settings.corners,
    settings.windowOpacity,
    settings.consoleFontSize,
    settings.consoleFont,
    settings.reduceMotion,
  ]);

  useEffect(() => {
    let live = true;
    loadSettingsFile()
      .then((fromDisk) => {
        if (!live) return;
        if (fromDisk) {
          setSettings(fromDisk);

          saveSettings(fromDisk);
        } else {
          persistSettings(settingsRef.current);
        }
      })
      .catch(() => {});
    const flush = () => flushSettings();
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      live = false;
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", flush);
      flushSettings();
    };
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      persistSettings(next);
      return next;
    });
  };

  const notify = (kind: "ok" | "err" | "info", msg: string) => setToast({ kind, msg });

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
    checkForUpdate()
      .then((u) => u && setUpdate(u))
      .catch(() => {});
  }, []);

  const runUpdateCheck = useCallback(async () => {
    setUpdateChecking(true);
    try {
      const u = await checkForUpdate();
      if (u) {
        setUpdate(u);
        setUpdateDismissed(false);
        setToast({ kind: "info", msg: `Update available: v${u.version}` });
      } else {
        setToast({ kind: "ok", msg: "You're on the latest version" });
      }
    } catch (e) {
      setToast({ kind: "err", msg: `Update check failed: ${e}` });
    } finally {
      setUpdateChecking(false);
    }
  }, []);

  const runInstallUpdate = useCallback(async () => {
    if (!update) return;
    setUpdateBusy(true);
    setUpdatePct(0);
    try {
      await installUpdate(update, setUpdatePct);
    } catch (e) {
      setToast({ kind: "err", msg: `Update failed: ${e}` });
      setUpdateBusy(false);
      setUpdatePct(null);
    }
  }, [update]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.kind === "err" ? 7000 : 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const [sidebarW, setSidebarW] = useState(() => numPref("zymono.sidebarW", 290));
  useEffect(() => localStorage.setItem("zymono.sidebarW", String(sidebarW)), [sidebarW]);

  const autoConsoleH = () => clamp(Math.round(viewportH() * 0.27), 160, 460);
  const consoleUser = useRef(localStorage.getItem(CONSOLE_H_KEY) !== null);
  const [consoleH, setConsoleH] = useState(() =>
    consoleUser.current ? numPref(CONSOLE_H_KEY, autoConsoleH()) : autoConsoleH()
  );
  const consoleMax = () => Math.max(240, viewportH() - 300);
  const applyConsoleH = (v: number) => {
    const next = clamp(v, 120, consoleMax());
    consoleUser.current = true;
    localStorage.setItem(CONSOLE_H_KEY, String(next));
    setConsoleH(next);
  };
  useEffect(() => {
    const onResize = () => {
      if (consoleUser.current) setConsoleH((h) => clamp(h, 120, consoleMax()));
      else setConsoleH(autoConsoleH());
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    hintArmed.current = true;
    if (configRef.current) configRef.current.scrollTop = 0;
    updateScroll();
    const iv = window.setInterval(updateScroll, 400);
    window.addEventListener("resize", updateScroll);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("resize", updateScroll);
    };
  }, [updateScroll, selected, dllPath, injectMethod, showGuide, log.length, consoleH, sidebarW]);

  const append = useCallback((line: string) => {
    setLog((prev) => [...prev, line]);
  }, []);

  useEffect(() => {
    const un = listen<string>("zymono://log", (e) => append(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, [append]);

  useEffect(() => {
    const un = listen<string>("zymono://proxy-log", (e) => append(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, [append]);

  useEffect(() => {
    if (!selected || dllPath) return;
    setNative(false);
  }, [selected?.pid]);

  useEffect(() => {
    if (runState !== "running") return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt.current), 100);
    return () => clearInterval(id);
  }, [runState]);

  useEffect(() => {
    setRunState((s) => (s === "running" || s === "idle" ? s : "idle"));
  }, [selected?.pid, dllPath]);

  useEffect(() => {
    if (!dllPath) {
      setDllEntries(null);
      setDllRefs([]);
      setDllKind(null);
      return;
    }
    let live = true;
    invoke<EntryPoint[]>("list_entry_points", { dllPath })
      .then((e) => live && setDllEntries(e))
      .catch(() => live && setDllEntries([]));
    invoke<string[]>("assembly_references", { dllPath })
      .then((r) => live && setDllRefs(r))
      .catch(() => live && setDllRefs([]));
    invoke<DllKind>("dll_kind", { dllPath })
      .then((k) => live && setDllKind(k))
      .catch(() => live && setDllKind(null));
    return () => {
      live = false;
    };
  }, [dllPath]);

  useEffect(() => {
    if (!dllKind) return;
    if (dllKind.kind === "native") setNative(true);
    else if (dllKind.kind === "managed") setNative(false);
  }, [dllKind?.kind]);

  const usesHarmony = dllRefs.some((r) => /harmony/i.test(r));
  const entryMatch = (() => {
    if (!dllEntries || !className.trim() || !method.trim()) return null;
    return (
      dllEntries.find(
        (e) =>
          e.class === className.trim() &&
          e.method === method.trim() &&
          (namespace.trim() === "" || e.namespace === namespace.trim())
      ) ?? null
    );
  })();
  const expectedArgs = entryMatch?.param_count ?? null;
  const entryStatus = (() => {
    if (!dllEntries || !className.trim() || !method.trim()) return null;
    if (!entryMatch) return { kind: "err" as const, msg: "Not found in this DLL — check Browse methods" };
    if (!entryMatch.is_static || !entryMatch.returns_void)
      return { kind: "warn" as const, msg: "Found, but not static void — may fail" };
    return { kind: "ok" as const, msg: "Entry point found" };
  })();

  useEffect(() => {
    const dllsIn = (paths: string[]) => paths.filter((p) => p.toLowerCase().endsWith(".dll"));

    const un = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") {
        const paths = event.payload.paths ?? [];
        const dlls = dllsIn(paths);
        setDrag({
          name: basename(dlls[0] ?? paths[0] ?? ""),
          count: dlls.length,
          ok: dlls.length > 0,
        });
      } else if (event.payload.type === "over") {
        setDrag((d) => d ?? { name: "", count: 0, ok: true });
      } else if (event.payload.type === "leave") {
        setDrag(null);
      } else if (event.payload.type === "drop") {
        setDrag(null);
        const dlls = dllsIn(event.payload.paths);
        if (dlls.length === 0) {
          setToast({ kind: "err", msg: "That's not a .dll — drop a .NET mod assembly (.dll)." });
          return;
        }
        pickDll(dlls[0]);
        setToast({
          kind: "ok",
          msg:
            dlls.length > 1
              ? `Loaded ${basename(dlls[0])} — ${dlls.length - 1} other .dll${
                  dlls.length > 2 ? "s" : ""
                } ignored`
              : `Loaded ${basename(dlls[0])}`,
        });
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const startDrag =
    (axis: "x" | "y", getStart: () => number, apply: (next: number) => void, sign: 1 | -1) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      const origin = axis === "x" ? e.clientX : e.clientY;
      const startVal = getStart();
      const move = (ev: MouseEvent) => {
        const delta = toLocal((axis === "x" ? ev.clientX : ev.clientY) - origin);
        apply(startVal + sign * delta);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    };

  const onSelect = useCallback((proc: MonoProcess) => {
    setSelected(proc);
    setProfilePrompt(null);
    if (suppressPreset.current) {
      suppressPreset.current = false;
      return;
    }

    const f = formRef.current;
    const touched = !!(f.dllPath || f.namespace.trim() || f.className.trim() || f.method.trim());

    const exe = proc.exe_path ? basename(proc.exe_path).toLowerCase() : null;
    const matches = exe
      ? sortProfiles(profilesRef.current.filter((p) => (p.gameExe ?? "").toLowerCase() === exe))
      : [];
    const mode = settingsRef.current.profileAutofill;
    if (matches.length && mode === "auto" && !touched) {
      applyProfile(matches[0]);
      return;
    }
    if (matches.length && (mode === "ask" || touched)) {
      setProfilePrompt(matches[0]);
    }

    if (!touched && proc.exe_path) {
      const preset = loadPresets()[proc.exe_path];
      if (preset) {
        setDllPath(preset.dll);
        setNamespace(preset.namespace);
        setClassName(preset.className);
        setMethod(preset.method);
        setArgs(preset.args ?? []);
        setUnloadEntry(preset.unload ?? "");
      }
    }
  }, []);

  const onContext = useCallback(
    (
      proc: MonoProcess,
      e: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }
    ) => {
      e.preventDefault();
      e.stopPropagation();
      setCtxMenu({ x: toLocal(e.clientX), y: toLocal(e.clientY), proc });
    },
    []
  );

  const onProcessList = useCallback((procs: MonoProcess[]) => {
    targetsRef.current = procs;
    setTargets(procs);

    if (settingsRef.current.autoInject) {
      const livePids = new Set(procs.map((p) => p.pid));
      autoInjectedPids.current.forEach((pid) => {
        if (!livePids.has(pid)) autoInjectedPids.current.delete(pid);
      });
      for (const prof of profilesRef.current) {
        if (!prof.autoInject) continue;
        const t = matchTarget(prof, procs);
        if (t && !autoInjectedPids.current.has(t.pid) && !scheduledAuto.current.has(t.pid)) {
          const pid = t.pid;
          scheduledAuto.current.add(pid);
          const delay = Math.max(10, Math.min(30000, settingsRef.current.autoInjectDelayMs ?? 5000));
          const secs = (delay / 1000).toFixed(delay % 1000 === 0 ? 0 : 1);
          setToast({ kind: "info", msg: `Auto-inject: ${prof.name} → ${t.name} (arming, ${secs}s…)` });
          window.setTimeout(() => {
            scheduledAuto.current.delete(pid);
            const cur = targetsRef.current.find((x) => x.pid === pid);
            if (cur && !autoInjectedPids.current.has(pid)) {
              autoInjectedPids.current.add(pid);

              setSelected(cur);
              runInjectionRef.current(cur, {
                dllPath: prof.dllPath,
                namespace: prof.namespace,
                className: prof.className,
                method: prof.method,
                args: prof.args,
                methodMode: prof.methodMode,
              });
            }
          }, 4000);
        }
      }
    }

    setSelected((cur) => {
      if (!cur) return cur;

      if (procs.some((p) => p.pid === cur.pid)) return cur;

      if (cur.exe_path) {
        const sameExe = procs.filter((p) => p.exe_path === cur.exe_path && p.pid !== cur.pid);
        const live = sameExe.find((p) => !p.duplicate) ?? sameExe[0];
        if (live) return live;
      }

      return null;
    });
  }, []);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast({ kind: "info", msg: `Copied ${label}` });
    } catch {
      setToast({ kind: "err", msg: "Clipboard copy failed" });
    }
  };

  const busy = runState === "running";

  const autoRegister = !!dllKind && (dllKind.has_melon_info || dllKind.has_bep_in_plugin);
  const canInject = !busy && !!dllPath && !!selected && selected.injectable && (
    native ? true : autoRegister ? true : (!!className.trim() && !!method.trim())
  );
  const canEject =
    !busy && !!dllPath && !!unloadEntry.trim() && !!selected && selected.injectable && !native;

  const injectHint = (() => {
    if (canInject || busy) return null;
    if (!selected) return "Select a target on the left";
    if (!selected.injectable) return "This target isn't injectable";
    if (!dllPath) return "Choose a mod DLL";
    if (native || autoRegister) return null;
    if (!className.trim()) return "Enter the class name";
    if (!method.trim()) return "Enter the method name";
    return null;
  })();

  const runInjection = async (target: MonoProcess, cfg: InjectCfg) => {
    if (!cfg.invokeOnly) {
      savePreset(target.exe_path ?? "", {
        dll: cfg.dllPath,
        namespace: cfg.namespace,
        className: cfg.className,
        method: cfg.method,
        args: cfg.args,
        unload: unloadEntry,
      });
    }
    if (settings.clearOnInject) setLog([]);
    setRunState("running");
    startedAt.current = Date.now();
    setElapsed(0);
    try {
      await invoke("inject", {
        request: {
          pid: target.pid,
          dll_path: cfg.dllPath,
          namespace: cfg.namespace,
          class_name: cfg.className,
          method: cfg.method,
          args: cfg.args,
          method_mode: cfg.methodMode,
          timeout_secs: settings.timeoutSecs,
          delay_ms: cfg.invokeOnly ? 0 : settings.injectDelayMs,
          invoke_only: !!cfg.invokeOnly,
          native: !!cfg.native,
          native_mode: cfg.nativeMode ?? "loadlibrary",
        },
      });
      setRunState("ok");
      setToast({
        kind: "ok",
        msg: cfg.invokeOnly ? "Unload entry point called" : "Injection succeeded",
      });
    } catch (e) {
      append(`✗ ${e}`);
      setRunState("err");
      setToast({ kind: "err", msg: String(e) });
    } finally {
      setElapsed(Date.now() - startedAt.current);
    }
  };
  runInjectionRef.current = runInjection;

  const onInject = () => {
    if (!selected) return;

    const cfg: InjectCfg = autoRegister && !native
      ? { dllPath, namespace: "", className: "", method: "", args: [], methodMode: injectMethod, native, nativeMode }
      : { dllPath, namespace, className, method, args, methodMode: injectMethod, native, nativeMode };
    runInjection(selected, cfg);
  };

  const onEject = () => {
    if (!selected) return;
    const parts = splitEntryPoint(unloadEntry);
    if (!parts) {
      setToast({ kind: "err", msg: "Unload entry point should look like MyMod.Loader.Unload" });
      return;
    }
    runInjection(selected, {
      dllPath,
      namespace: parts.namespace,
      className: parts.className,
      method: parts.method,
      args: [],
      methodMode: injectMethod,
      invokeOnly: true,
    });
  };

  const applyProfile = (p: Profile) => {
    setDllPath(p.dllPath);
    setNamespace(p.namespace);
    setClassName(p.className);
    setMethod(p.method);
    setUnloadEntry(p.unload ?? "");
    setArgs(p.args);
    setInjectMethod(p.methodMode);
    setNative(!!p.native);
    setNativeMode(p.nativeMode ?? "loadlibrary");
    setActiveProfileId(p.id);
  };
  const onLoadProfile = (p: Profile) => {
    applyProfile(p);
    const t = matchTarget(p, targetsRef.current);
    if (t) {
      suppressPreset.current = true;
      setSelected(t);
      setSidebarTab("targets");
      setToast({ kind: "info", msg: `Loaded "${p.name}" — ready on ${t.name}` });
    } else {
      setToast({ kind: "info", msg: `Loaded "${p.name}"` });
    }
  };
  const onInjectProfile = (p: Profile, t: MonoProcess) => {
    applyProfile(p);
    suppressPreset.current = true;
    setSelected(t);
    setSidebarTab("targets");
    runInjection(t, {
      dllPath: p.dllPath,
      namespace: p.namespace,
      className: p.className,
      method: p.method,
      args: p.args,
      methodMode: p.methodMode,
    });
  };
  const profileFromForm = (id: string, name: string): Profile => ({
    id,
    name,
    dllPath,
    namespace,
    className,
    method,
    unload: unloadEntry,
    args,
    methodMode: injectMethod,
    native,
    nativeMode,
    gameExe: selected?.exe_path ? basename(selected.exe_path) : null,
    gameName: selected?.name ?? null,
    updated: Date.now(),
    favorite: profiles.find((x) => x.id === id)?.favorite ?? false,
    autoInject: profiles.find((x) => x.id === id)?.autoInject ?? false,
  });
  const doSaveNew = (name: string) => {
    const p = profileFromForm(newId(), name);
    persistProfiles(upsert(profiles, p));
    setActiveProfileId(p.id);
    setSavePop(null);
    setToast({ kind: "ok", msg: `Saved profile "${name}"` });
  };
  const doUpdateProfile = () => {
    if (!activeProfileId) return;
    const existing = profiles.find((x) => x.id === activeProfileId);
    const p = profileFromForm(activeProfileId, existing?.name ?? "Profile");
    persistProfiles(upsert(profiles, p));
    setSaveMenu(null);
    setToast({ kind: "ok", msg: `Updated "${p.name}"` });
  };
  const onRenameProfile = (id: string, name: string) => {
    const ex = profiles.find((x) => x.id === id);
    if (ex) persistProfiles(upsert(profiles, { ...ex, name, updated: Date.now() }));
  };
  const onDeleteProfile = (id: string) => {
    persistProfiles(remove(profiles, id));
    if (activeProfileId === id) setActiveProfileId(null);
  };
  const onDuplicateProfile = (id: string) => persistProfiles(duplicate(profiles, id));
  const onToggleFavorite = (id: string) => {
    const ex = profiles.find((x) => x.id === id);
    if (ex) persistProfiles(upsert(profiles, { ...ex, favorite: !ex.favorite }));
  };
  const onToggleAutoInject = (id: string) => {
    const ex = profiles.find((x) => x.id === id);
    if (!ex) return;
    persistProfiles(upsert(profiles, { ...ex, autoInject: !ex.autoInject }));
    setToast({
      kind: "info",
      msg: ex.autoInject
        ? `Auto-inject off for "${ex.name}"`
        : `Auto-inject on for "${ex.name}" — enable the master switch in Settings › General`,
    });
  };
  const onExportProfiles = async () => {
    if (profiles.length === 0) {
      setToast({ kind: "info", msg: "No profiles to export" });
      return;
    }
    try {
      const path = await save({
        defaultPath: "zymono-profiles.json",
        filters: [{ name: "Profiles", extensions: ["json"] }],
      });
      if (!path) return;
      await invoke("save_text", { path, content: JSON.stringify(profiles, null, 2) });
      setToast({ kind: "ok", msg: `Exported ${profiles.length} profile${profiles.length > 1 ? "s" : ""}` });
    } catch (e) {
      setToast({ kind: "err", msg: String(e) });
    }
  };
  const onImportProfiles = async () => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "Profiles", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      const text = await invoke<string>("read_text", { path });
      const imported = parseProfiles(text).map((p) => ({ ...p, id: newId(), updated: Date.now() }));
      if (imported.length === 0) {
        setToast({ kind: "err", msg: "No profiles found in that file" });
        return;
      }
      persistProfiles([...profiles, ...imported]);
      setSidebarTab("profiles");
      setToast({ kind: "ok", msg: `Imported ${imported.length} profile${imported.length === 1 ? "" : "s"}` });
    } catch (e) {
      setToast({ kind: "err", msg: `Import failed: ${e}` });
    }
  };

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;
  const canSave = !!(dllPath || className.trim() || method.trim());
  const formDirty =
    !!activeProfile &&
    (activeProfile.dllPath !== dllPath ||
      activeProfile.namespace !== namespace ||
      activeProfile.className !== className ||
      activeProfile.method !== method ||
      (activeProfile.unload ?? "") !== unloadEntry ||
      activeProfile.methodMode !== injectMethod ||
      (activeProfile.native ?? false) !== native ||
      (activeProfile.nativeMode ?? "loadlibrary") !== nativeMode ||
      JSON.stringify(activeProfile.args) !== JSON.stringify(args));

  const onSaveClick = (e: React.MouseEvent) => {
    const r = localRect(e.currentTarget as HTMLElement);
    if (activeProfileId) setSaveMenu({ x: r.right, y: r.top - 6 });
    else setSavePop({ x: r.right, y: r.top - 6 });
  };

  const copyPid = async () => {
    if (!selected) return;
    await copyText(String(selected.pid), `PID ${selected.pid}`);
  };

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(log.join("\n"));
      setToast({ kind: "info", msg: "Console copied" });
    } catch {
      setToast({ kind: "err", msg: "Clipboard copy failed" });
    }
  };
  const saveLog = async () => {
    try {
      const path = await save({
        defaultPath: "zymono-log.txt",
        filters: [{ name: "Log", extensions: ["txt", "log"] }],
      });
      if (!path) return;
      await invoke("save_text", { path, content: log.join("\n") });
      setToast({ kind: "info", msg: "Log saved" });
    } catch (e) {
      setToast({ kind: "err", msg: String(e) });
    }
  };

  const onCancel = async () => {
    if (!selected) return;
    append("→ cancel requested…");
    try {
      await invoke("cancel_injection", { pid: selected.pid });
    } catch (e) {
      append(`✗ ${e}`);
    }
  };

  const clearConsole = () => {
    setLog([]);
    setRunState("idle");
  };

  const openPlayerLog = async () => {
    try {
      const gameDir = selected?.game_dir ?? null;
      const p = await invoke<string>("open_player_log", { gameDir });
      append(`→ opened ${p}`);
    } catch (e) {
      append(`✗ ${e}`);
    }
  };

  const kb = useRef({ inject: onInject, cancel: onCancel, clear: clearConsole, canInject, busy });
  kb.current = { inject: onInject, cancel: onCancel, clear: clearConsole, canInject, busy };

  useEffect(() => {
    invoke("set_inject_hotkey", { accel: settings.injectHotkey || null }).catch((e) =>
      setToast({ kind: "err", msg: String(e) })
    );
  }, [settings.injectHotkey]);

  useEffect(() => {
    const un = listen("zymono://hotkey-inject", () => {
      if (kb.current.busy) return;
      if (!kb.current.canInject) {
        setToast({ kind: "err", msg: "Hotkey: nothing to inject yet — pick a target and a DLL first" });
        return;
      }
      setToast({ kind: "info", msg: "Hotkey: injecting…" });
      kb.current.inject();
    });
    return () => {
      un.then((f) => f());
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === "Enter") {
        e.preventDefault();
        if (kb.current.canInject) kb.current.inject();
      } else if (e.key === "Escape" && kb.current.busy) {
        e.preventDefault();
        kb.current.cancel();
      } else if (meta && e.key.toLowerCase() === "l") {
        e.preventDefault();
        kb.current.clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
    {splash && <Launch reduced={settings.reduceMotion} onDone={() => { (window as unknown as { __zymonoSplashDone?: boolean }).__zymonoSplashDone = true; setSplash(false); }} />}
    <div className="app">
      <ResizeHandles />
      {toast && (
        <div className={`toast ${toast.kind}`}>
          {toast.kind === "ok" && <CheckCircle2 size={16} />}
          {toast.kind === "err" && <XCircle size={16} />}
          <span>{toast.msg}</span>
        </div>
      )}
      {drag && (
        <div className={`drop-overlay${drag.ok ? "" : " reject"}`}>
          <div className="drop-card">
            {drag.ok ? (
              <>
                <FileCode2 size={26} strokeWidth={1.6} />
                <span className="dc-title">
                  {drag.name ? `Drop ${drag.name} to load it` : "Drop a .dll to load it"}
                </span>
                {drag.count > 1 && (
                  <span className="dc-sub">{drag.count} .dll files — the first one is used</span>
                )}
              </>
            ) : (
              <>
                <Ban size={26} strokeWidth={1.6} />
                <span className="dc-title">{drag.name || "That file"} isn't a .dll</span>
                <span className="dc-sub">ZyMono injects .NET mod assemblies (.dll)</span>
              </>
            )}
          </div>
        </div>
      )}
      {ctxMenu && (
        <ProcessContextMenu
          proc={ctxMenu.proc}
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          onSelect={onSelect}
          onCopy={copyText}
          onOpenPlayerLog={openPlayerLog}
        />
      )}
      {browserOpen && dllPath && (
        <MetadataBrowser
          dllPath={dllPath}
          onClose={() => setBrowserOpen(false)}
          onPick={(ep) => {
            setNamespace(ep.namespace);
            setClassName(ep.class);
            setMethod(ep.method);
            setArgs(ep.param_count > 0 ? Array(ep.param_count).fill("") : []);
            setBrowserOpen(false);
          }}
        />
      )}
      <TitleBar onSettings={() => setSettingsOpen(true)} />
      {settingsOpen && (
        <SettingsModal
          settings={settings}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          appVersion={appVersion}
          updateVersion={update?.version ?? null}
          checkingUpdate={updateChecking}
          onCheckUpdates={runUpdateCheck}
          onInstallUpdate={runInstallUpdate}
          updateBusy={updateBusy}
        />
      )}
      {proxyOpen && (
        <ProxyPanel
          gameDir={selected?.game_dir ?? null}
          defaultModPath={dllPath}
          onClose={() => setProxyOpen(false)}
          onToast={notify}
        />
      )}
      {savePop && (
        <SaveProfilePopover
          x={savePop.x}
          y={savePop.y}
          defaultName={suggestName(selected?.name ?? null, className, method)}
          onSave={doSaveNew}
          onClose={() => setSavePop(null)}
        />
      )}
      {saveMenu && (
        <MenuPopup
          x={saveMenu.x}
          y={saveMenu.y}
          onClose={() => setSaveMenu(null)}
          items={[
            {
              label: `Update "${activeProfile?.name ?? "profile"}"`,
              icon: <BookMarked size={14} />,
              onClick: doUpdateProfile,
            },
            {
              label: "Save as new…",
              icon: <Copy size={14} />,
              sep: true,
              onClick: () => setSavePop({ x: saveMenu.x, y: saveMenu.y }),
            },
          ]}
        />
      )}
      {update && !updateDismissed && (
        <div className="update-banner">
          <Sparkles size={15} className="ub-icon" />
          <span className="ub-text">
            ZyMono <strong>v{update.version}</strong> is available
            {appVersion ? <span className="ub-cur"> · you have v{appVersion}</span> : null}
          </span>
          {updateBusy ? (
            <span className="ub-progress">
              {updatePct == null ? "Installing…" : `Installing ${updatePct}%`}
            </span>
          ) : (
            <>
              <button className="ub-install" onClick={runInstallUpdate}>
                <Download size={14} /> Download &amp; install
              </button>
              <button className="ub-later" onClick={() => setUpdateDismissed(true)}>
                Later
              </button>
            </>
          )}
        </div>
      )}
      <div className="workspace">
        <aside className="sidebar" style={{ width: sidebarW }}>
          <div className="sidebar-tabs">
            <button
              className={sidebarTab === "targets" ? "active" : ""}
              onClick={() => setSidebarTab("targets")}
            >
              Targets
            </button>
            <button
              className={sidebarTab === "profiles" ? "active" : ""}
              onClick={() => setSidebarTab("profiles")}
            >
              Profiles
              {profiles.length > 0 && <span className="tab-count">{profiles.length}</span>}
            </button>
          </div>

          <div className="sidebar-body" style={{ display: sidebarTab === "targets" ? "flex" : "none" }}>
            <ProcessList
              selectedPid={selected?.pid ?? null}
              onSelect={onSelect}
              onContext={onContext}
              onList={onProcessList}
              onSearchFocus={() => setSidebarTab("targets")}
              refreshMs={settings.refreshMs}
            />
          </div>
          {sidebarTab === "profiles" && (
            <div className="sidebar-body">
              <ProfilesList
                profiles={profiles}
                targets={targets}
                activeId={activeProfileId}
                onLoad={onLoadProfile}
                onInject={onInjectProfile}
                onRename={onRenameProfile}
                onDelete={onDeleteProfile}
                onDuplicate={onDuplicateProfile}
                onToggleFavorite={onToggleFavorite}
                onToggleAutoInject={onToggleAutoInject}
                onImport={onImportProfiles}
                onExport={onExportProfiles}
              />
            </div>
          )}
        </aside>
        <div
          className="resize-x"
          onMouseDown={startDrag("x", () => sidebarW, (v) => setSidebarW(clamp(v, 210, 520)), 1)}
        />

        <div className="main">
          <div className="context-bar">
            <div className="ctx-target">
              <span
                className={`ctx-dot ${selected ? (selected.injectable ? "on" : "warn") : ""}`}
              />
              {selected ? (
                <div className="ctx-target-text">
                  <span className="ctx-name">{selected.name}</span>
                  <span className="ctx-meta">
                    PID {selected.pid} · {selected.flavor} · {selected.arch} · {selected.thread_count} threads
                  </span>
                </div>
              ) : (
                <div className="ctx-target-text">
                  <span className="ctx-name muted">No target selected</span>
                  <span className="ctx-meta">Pick a process from the left</span>
                </div>
              )}
              {selected && (
                <button className="ctx-copy" onClick={copyPid} title="Copy PID">
                  <Copy size={14} />
                </button>
              )}
            </div>
            <div className="mode-wrap">
              <InfoTip text="ZyMono attaches to a running Unity game — Mono or IL2CPP — and loads your C# assembly or native DLL, then calls its entry point." />
            </div>
          </div>

          <div className="config-region">
          <div className="config" ref={configRef} onScroll={updateScroll}>
            {profilePrompt && selected && (
              <div className="profile-prompt">
                <BookMarked size={15} />
                <span className="pp-text">
                  Saved profile <strong>{profilePrompt.name}</strong> matches this game.
                </span>
                <button
                  className="pp-apply"
                  onClick={() => {
                    applyProfile(profilePrompt);
                    setProfilePrompt(null);
                  }}
                >
                  Apply
                </button>
                <button className="pp-dismiss" title="Dismiss" onClick={() => setProfilePrompt(null)}>
                  <X size={14} />
                </button>
              </div>
            )}
            {!selected && log.length === 0 && showGuide && (
              <div className="guide-card">
                <div className="guide-head">
                  <span>Getting started</span>
                  <button className="icon-btn" onClick={dismissGuide} title="Dismiss">
                    <X size={14} />
                  </button>
                </div>
                <ol className="guide-steps">
                  <li>
                    <strong>Pick a target</strong> on the left — both Mono and IL2CPP Unity
                    games are injectable; ZyMono picks the route for you.
                  </li>
                  <li>
                    <strong>Choose your mod DLL</strong> and its entry point (Namespace.Class.Method)
                    — <strong>Browse methods</strong> lists them straight from the DLL.
                  </li>
                  <li>
                    <strong>Inject</strong> — ZyMono auto-picks direct vs pipe injection based on
                    what's actually live in the game. Progress appears in the console below.
                  </li>
                </ol>
              </div>
            )}
            {selected && selected.injectable && (
              <RouterPanel
                selected={selected}
                method={injectMethod}
                onMethodChange={setInjectMethod}
                onToast={notify}
                showMethodPicker={!native}
              />
            )}
            <InjectForm
              selected={selected}
              dllPath={dllPath}
              onDllPick={pickDll}
              modFolder={settings.modFolder}
              namespace={namespace}
              onNamespaceChange={setNamespace}
              className={className}
              onClassChange={setClassName}
              method={method}
              onMethodChange={setMethod}
              args={args}
              onArgsChange={setArgs}
              onBrowse={() => setBrowserOpen(true)}
              usesHarmony={usesHarmony}
              entryStatus={entryStatus}
              unloadEntry={unloadEntry}
              onUnloadChange={setUnloadEntry}
              expectedArgs={expectedArgs}
              methodCount={dllEntries?.length ?? null}
              dllRefs={dllRefs}
              recent={recentDlls}
              onRecentChange={setRecentDlls}
              native={native}
              onNativeChange={setNative}
              nativeMode={nativeMode}
              onNativeModeChange={setNativeMode}
              onOpenProxy={() => setProxyOpen(true)}
              dllKind={dllKind}
              autoRegister={autoRegister}
            />
          </div>
            <div className={`config-fade${canScrollDown ? " show" : ""}`} />
            {hintOn && (
              <div className="scroll-hint">
                <ChevronDown size={13} /> scroll for more
              </div>
            )}
          </div>

          <div
            className="resize-y"
            onMouseDown={startDrag("y", () => consoleH, applyConsoleH, -1)}
          />

          <div className="action-bar">
            <div className="action-inner">
              <div className="action-summary">
                <span className="as-method">
                  {injectMethod === "auto"
                    ? "Auto route"
                    : injectMethod === "pipe"
                    ? "Pipe injection"
                    : "Direct injection"}
                </span>
                <span className="as-entry">
                  {selected
                    ? native
                      ? `${selected.name} · native ${nativeMode === "manual_map" ? "manual map" : "LoadLibrary"}`
                      : `${selected.name} · ${namespace ? namespace + "." : ""}${className || "Class"}.${method || "Method"}`
                    : "No target selected"}
                </span>
              </div>
              <div className="action-btns">
                {!!unloadEntry.trim() && (
                  <button
                    className="eject-btn"
                    disabled={!canEject}
                    onClick={onEject}
                    title="Call the unload entry point on the copy of your mod that is already loaded"
                  >
                    <Eraser size={14} /> Eject
                  </button>
                )}
                {busy && (
                  <button className="cancel-btn" onClick={onCancel}>
                    <Ban size={15} /> Cancel
                  </button>
                )}
                <button
                  className="save-btn"
                  disabled={!canSave || busy}
                  onClick={onSaveClick}
                  title={activeProfileId ? "Update this profile or save a new one" : "Save this setup as a profile"}
                >
                  <BookMarked size={14} />
                  {activeProfileId ? "Update" : "Save"}
                  {formDirty && <span className="save-dot" />}
                </button>
                <button
                  className="inject-btn"
                  disabled={!canInject}
                  onClick={onInject}
                  title={injectHint ?? undefined}
                >
                  <Syringe size={15} />
                  {busy ? "Injecting…" : runState === "ok" ? "Re-inject" : "Inject"}
                  <span className="inject-kbd">Ctrl ↵</span>
                </button>
              </div>
            </div>
          </div>

          <div className="console-region" style={{ height: consoleH }}>
            <StatusLog
              lines={log}
              onClear={clearConsole}
              runState={runState}
              elapsed={elapsed}
              onOpenPlayerLog={openPlayerLog}
              onCopyLog={copyLog}
              onSaveLog={saveLog}
            />
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
