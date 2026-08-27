# Changelog

All notable changes to **ZyMono**, newest first.
Downloads live at **[zlogic.eu/zymono](https://zlogic.eu/zymono/)**; the app updates itself from inside
**Settings -> About**.

---

## 🆕 What's new in 0.4.0

*The appearance release — and a fix for settings that refused to stay put.*

**💾 Your appearance settings stop resetting**
Settings lived in the WebView's local storage, which Windows could silently drop when ZyMono was quit
from the tray — so your accent colour and theme were back to defaults on the next launch. They now live
in a real file at `%APPDATA%\ZyMono\settings.json`, right beside your profiles, and survive a crash or a
force-kill. Your existing settings are migrated automatically the first time you launch 0.4.0.

**🎨 Nine new Appearance settings**
**Settings → Appearance** gained **UI scale** (85–130 %), **density** (cozy / compact), **corner style**
(sharp / rounded / pill), **window opacity** so you can watch the game through ZyMono, **console font**
and **console text size**, an **accent glow** toggle with a strength slider, and **reduce motion** —
which also skips the startup screen. Every one of them persists.

**🐞 Sidebar no longer spills into the main pane**
With a long profile name saved, the Profiles sidebar's search box and Export/Import buttons pushed past
the divider and overlapped the config panel. Long names now ellipsize the way they were always meant to.

---

## 🆕 What's new in 0.3.1

*A fix release for 0.3.0.*

**🐞 IL2CPP & MelonLoader receiver install fixed**
0.3.0 shipped only the classic BepInEx receiver inside the installer — the BepInEx-IL2CPP and MelonLoader
DLLs were built but never bundled. Installing either from a real (non-dev) install failed with
*"bundled receiver DLL not found — build the … project first"*. All three receivers
(`ZyMonoReceiver.dll`, `ZyMonoReceiverIL2CPP.dll`, `ZyMonoMelonReceiver.dll`) now ship with the app.

**📝 Wording corrected throughout**
ZyMono stopped being a Mono-only injector in 0.3.0, but the app metadata, tray tooltip, title bar and
About panel hadn't caught up. The in-app guide also still claimed *"IL2CPP games aren't injectable
(no Mono runtime)"* — flatly wrong since 0.3.0. All corrected.

---

## 🆕 What's new in 0.3.0

*The IL2CPP release. ZyMono is no longer a Mono-only injector — it now speaks native C++, IL2CPP, BepInEx-IL2CPP, and MelonLoader too.*

<table>
<tr>
<td width="50%" valign="top">

**🎯 IL2CPP games — first-class support**
IL2CPP games are no longer marked "not injectable". ZyMono now knows there are two mod worlds inside every Unity game — **managed C#** and **native C++** — and routes to the right one based on what you actually picked. Select an IL2CPP game, pick a `.dll`, ZyMono inspects it and picks the route for you.

**🧬 Native (C++) mod loading**
Three brand-new routes for native mods that no managed injector can touch:

- **LoadLibrary** — the classic on-demand path. The game itself calls `LoadLibraryW` on your DLL; Windows' own loader runs `DllMain(DLL_PROCESS_ATTACH)` and you're in.
- **Manual map** — an in-memory PE loader. The DLL is copied into the game as a memory buffer, sections copied, relocations applied, imports resolved, `DllMain` fired — no file on disk needs to remain readable. The native analog of the direct Mono route.
- **Proxy preloader** — drops a signed-clean `winhttp.dll` / `version.dll` stub next to the game exe so your mod auto-loads at next launch. The exact mechanism BepInEx and MelonLoader use themselves — now available for your own native mods.

**🧠 DLL-aware routing**
The picker now inspects every DLL you point it at: managed vs native, x86 / x64 / AnyCPU, and — for managed DLLs — whether it carries `[BepInPlugin]` or `[MelonInfo]`. The route panel reshapes around what you picked. A C++ DLL hides the pipe route entirely. A C# DLL hides the native tabs. A wrong-bitness DLL says so up front.

</td>
<td width="50%" valign="top">

**🎭 Two new pipe receivers — BepInEx-IL2CPP & MelonLoader**
The pipe route now covers all three modern Unity mod-loader worlds:

- `ZyMonoReceiver.dll` — BepInEx classic (Mono) — as before
- `ZyMonoReceiverIL2CPP.dll` — **new** — BepInEx-IL2CPP, `BasePlugin` + `Il2CppInterop`, class-injected dispatcher
- `ZyMonoMelonReceiver.dll` — **new** — MelonLoader, `MelonMod` + `OnUpdate`-pumped dispatcher

ZyMono detects which loader is live in the game and installs — or **updates in place** — the matching receiver with one click.

**⚡ MelonMod / BepInPlugin auto-registration**
Drop a MelonMod DLL onto ZyMono and there's **nothing to fill in**. ZyMono spots the `[MelonInfo]` attribute, the entry-point column disappears, and the receiver hands the assembly to `MelonAssembly.LoadMelonAssembly` — MelonLoader runs the full startup pipeline (Register → OnInitializeMelon → OnLateInitializeMelon → OnUpdate hookup) exactly as if the file had been in `Mods/` at launch. The same lane exists for `[BepInPlugin]` via `Chainloader`.

**🔀 Loader detection: BepInEx vs MelonLoader vs none**
The status pill now reads *"MelonLoader live"* / *"BepInEx live"* / *"no mod loader"* correctly — the old "BepInEx live" false positive on MelonLoader games is gone. Uses loader-specific module signatures plus the `winhttp.dll` (BepInEx) vs `version.dll` (MelonLoader) proxy heuristic.

**🩹 UX cleanup**
Direct/Pipe/Auto is hidden when a native DLL is picked (pipe doesn't apply). The "no managed methods found" warning is gone in native mode. Install/Update prompt no longer auto-dismisses after 2 s. **Update receiver…** button when the receiver is already live so you can push a fresh build without hunting through folders. The stale "Uses Harmony — if BepInEx is live" hint is now loader-agnostic.

</td>
</tr>
</table>

---

## 🆕 What's new in 0.2.0

*A release shaped almost entirely by user feedback — every item below came from someone actually modding with it.*

<table>
<tr>
<td width="50%" valign="top">

**🔍 Search / filter the target list**
Type a few letters — `Raft` — and the Targets list narrows instantly. <kbd>Ctrl</kbd>+<kbd>F</kbd> from anywhere jumps into the box; <kbd>Esc</kbd> clears it. No more hunting through thirty processes.

**📋 Paste a whole entry point**
Copy `RaftMod.Main.Init` from anywhere and paste it into **any** of the three entry-point boxes — ZyMono splits it into Namespace / Class / Method for you. It also cleans up what it's given: `RaftMod::Main::Init`, a trailing `(string[] args)`, or a copied log line all resolve correctly.

**📂 Recent DLLs dropdown**
A dropdown next to **Choose DLL** remembers the last **5** assemblies you injected. Re-testing the same mod is now one click instead of a file dialog. Entries can be forgotten individually.

**⌨️ Global inject hotkey**
Bind any combination (<kbd>F11</kbd>, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>I</kbd>, …) in **Settings → Injection** and fire an injection **while the game has focus** — no Alt-Tab. ZyMono toasts what happened, and tells you if there's nothing configured to inject yet.

</td>
<td width="50%" valign="top">

**⏏️ Optional unload / eject entry point**
Give ZyMono a second, optional entry point — `MyMod.Loader.Unload` — and an **Eject** button appears beside **Inject**. It calls that method on the copy of your assembly that is *already live*, so your statics are the ones `Init` set up. Reload a mod without restarting the game. Leave it blank and nothing changes.

**🖱️ Drag-and-drop a DLL**
Drop a `.dll` anywhere on the window to load it. The overlay names the file before you let go, and politely refuses anything that isn't a .NET assembly.

**🧭 Action bar moved next to the target**
**Save** and **Inject** now sit in a dedicated action bar directly under the form, alongside a live summary of *what* is about to be injected *where* — your eyes no longer cross the whole monitor between the target and the button that acts on it.

**🖥️ A real widescreen layout**
Maximize the window and the config panel reflows: one column → **two** at 780 px → **three** at 1500 px. No more 60 % of a widescreen monitor left as empty black space.

**♿ High-contrast mode**
**Settings → Appearance → High contrast** raises borders, surfaces and text contrast across the whole app, on top of whichever accent you use.

</td>
</tr>
</table>
