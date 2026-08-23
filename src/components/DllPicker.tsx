import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, FileCode2, Copy, RefreshCw, History, ChevronDown, X } from "lucide-react";
import InfoTip from "./InfoTip";
import MenuPopup from "./MenuPopup";
import { basename, dirname } from "../path";
import { forgetRecentDll } from "../recent";

interface Props {
  dllPath: string | null;
  onPick: (path: string) => void;
  defaultFolder: string | null;
  recent: string[];
  onRecentChange: (list: string[]) => void;
}

export default function DllPicker({ dllPath, onPick, defaultFolder, recent, onRecentChange }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [recentMenu, setRecentMenu] = useState<{ x: number; y: number } | null>(null);

  const pick = async () => {
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: defaultFolder ?? undefined,
      filters: [{ name: ".NET Assembly", extensions: ["dll"] }],
    });
    if (typeof selected === "string") onPick(selected);
  };

  const fileName = dllPath ? basename(dllPath) : null;

  return (
    <div className="field">
      <label>
        Mod DLL
        <InfoTip text="The .NET/Mono .dll to inject. For direct injection it's loaded straight from memory (never written to disk). You can also drag & drop a .dll onto the window." />
      </label>
      <div className="dll-picker">
        <div className="dll-choose">
          <button className="secondary-btn" onClick={pick}>
            <FolderOpen size={14} />
            Choose .dll
          </button>
          <button
            className="secondary-btn recent-btn"
            disabled={recent.length === 0}
            title={recent.length ? "Recently used DLLs" : "No recent DLLs yet"}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setRecentMenu({ x: r.right, y: r.bottom + 4 });
            }}
          >
            <History size={14} />
            <ChevronDown size={11} className="recent-caret" />
          </button>
        </div>
        <div
          className={`dll-chip${dllPath ? " has-file" : ""}`}
          title={dllPath ?? ""}
          onContextMenu={
            dllPath
              ? (e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY });
                }
              : undefined
          }
        >
          <FileCode2 size={13} />
          <span>{fileName ?? "No file selected"}</span>
        </div>
      </div>

      {recentMenu && recent.length > 0 && (
        <MenuPopup
          x={recentMenu.x}
          y={recentMenu.y}
          onClose={() => setRecentMenu(null)}
          items={[
            ...recent.map((p) => ({
              label: basename(p),
              sub: dirname(p),
              icon: <FileCode2 size={14} />,
              onClick: () => onPick(p),
              onRemove: () => onRecentChange(forgetRecentDll(p)),
            })),
            {
              label: "Choose another .dll…",
              icon: <FolderOpen size={14} />,
              sep: true,
              onClick: () => pick(),
            },
          ]}
        />
      )}

      {menu && dllPath && (
        <MenuPopup
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Copy path",
              icon: <Copy size={14} />,
              onClick: () => navigator.clipboard.writeText(dllPath).catch(() => {}),
            },
            {
              label: "Open containing folder",
              icon: <FolderOpen size={14} />,
              onClick: () => invoke("reveal_path", { path: dirname(dllPath) }).catch(() => {}),
            },
            {
              label: "Forget this DLL",
              icon: <X size={14} />,
              onClick: () => onRecentChange(forgetRecentDll(dllPath)),
            },
            {
              label: "Choose a different .dll…",
              icon: <RefreshCw size={14} />,
              sep: true,
              onClick: () => pick(),
            },
          ]}
        />
      )}
    </div>
  );
}
