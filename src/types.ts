export interface MonoProcess {
  pid: number;
  name: string;
  cmdline: string;
  flavor: string;
  module_path: string;
  data_dir: string | null;
  game_dir: string | null;
  exe_path: string | null;
  thread_count: number;
  arch: string;
  suspect: boolean;
  engine: string;
  injectable: boolean;
  duplicate: boolean;
  bepinex_live: boolean;
  mod_loader: string | null;
  app_id: string | null;
}

export interface DllKind {
  kind: "managed" | "native" | "unknown";

  arch: "x64" | "x86" | "anycpu" | "unknown";

  has_bep_in_plugin: boolean;
  has_melon_info: boolean;
}

export interface EntryPoint {
  namespace: string;
  class: string;
  method: string;
  is_static: boolean;
  param_count: number;
  returns_void: boolean;
}

export type RunState = "idle" | "running" | "ok" | "err";

export type InjectMethod = "auto" | "direct" | "pipe";

export type NativeMode = "loadlibrary" | "manual_map";

export interface Profile {
  id: string;
  name: string;
  dllPath: string | null;
  namespace: string;
  className: string;
  method: string;
  unload?: string;
  args: string[];
  methodMode: InjectMethod;
  native?: boolean;
  nativeMode?: NativeMode;
  gameExe: string | null;
  gameName: string | null;
  updated: number;
  favorite: boolean;
  autoInject: boolean;
}

export interface ProxyPlan {
  proxy_name: string;
  install_path: string;
  target_mod_path: string;
  arch: string;
  existing_will_be_backed_up: boolean;
}

export interface ReceiverHello {
  version: string;
  game: string | null;
  mono_domain_ready: boolean;
}

export interface RouterProbe {
  bepinex_live: boolean;
  loader_name: string | null;
  receiver: ReceiverHello | null;
  recommended: InjectMethod;
  reason: string;
}
