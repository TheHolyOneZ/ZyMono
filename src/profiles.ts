import type { MonoProcess, Profile } from "./types";
import { basename } from "./path";

export function parseProfiles(json: string): Profile[] {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch {
    return [];
  }
}

export function migrateFromLocalStorage(): Profile[] {
  try {
    const raw = localStorage.getItem("zymono.profiles");
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch {
    return [];
  }
}

function normalize(p: Partial<Profile>): Profile {
  return {
    id: p.id || newId(),
    name: p.name || "Untitled",
    dllPath: p.dllPath ?? null,
    namespace: p.namespace ?? "",
    className: p.className ?? "",
    method: p.method ?? "",
    args: p.args ?? [],
    methodMode: p.methodMode ?? "auto",
    gameExe: p.gameExe ?? null,
    gameName: p.gameName ?? null,
    updated: p.updated ?? Date.now(),
    favorite: p.favorite ?? false,
    autoInject: p.autoInject ?? false,
  };
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function upsert(list: Profile[], p: Profile): Profile[] {
  const i = list.findIndex((x) => x.id === p.id);
  const next = [...list];
  if (i >= 0) next[i] = p;
  else next.push(p);
  return next;
}

export function remove(list: Profile[], id: string): Profile[] {
  return list.filter((x) => x.id !== id);
}

export function duplicate(list: Profile[], id: string): Profile[] {
  const src = list.find((x) => x.id === id);
  if (!src) return list;
  return [
    ...list,
    { ...src, id: newId(), name: `${src.name} copy`, updated: Date.now(), favorite: false, autoInject: false },
  ];
}

export function sortProfiles(list: Profile[]): Profile[] {
  return [...list].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return b.updated - a.updated;
  });
}

export function matchTarget(profile: Profile, targets: MonoProcess[]): MonoProcess | null {
  if (!profile.gameExe) return null;
  const want = profile.gameExe.toLowerCase();
  const live = targets.filter(
    (t) => t.injectable && !t.duplicate && t.exe_path && basename(t.exe_path).toLowerCase() === want
  );
  return live[0] ?? null;
}

export function suggestName(gameName: string | null, className: string, method: string): string {
  const entry = [className, method].filter(Boolean).join(".");
  if (gameName && entry) return `${gameName} · ${entry}`;
  if (gameName) return gameName;
  if (entry) return entry;
  return "New profile";
}
