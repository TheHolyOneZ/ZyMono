import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, FileCode2, Copy, RefreshCw } from "lucide-react";
import InfoTip from "./InfoTip";
import MenuPopup from "./MenuPopup";
import { basename, dirname } from "../path";

interface Props {
  dllPath: string | null;
  onPick: (path: string) => void;
  defaultFolder: string | null;
}

export default function DllPicker({ dllPath, onPick, defaultFolder }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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
        <button className="secondary-btn" onClick={pick}>
          <FolderOpen size={14} />
          Choose .dll
        </button>
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
