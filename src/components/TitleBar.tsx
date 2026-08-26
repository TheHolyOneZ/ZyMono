import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X, Settings2 } from "lucide-react";
import logoUrl from "../assets/logo.png";

const appWindow = getCurrentWindow();

interface Props {
  onSettings: () => void;
}

export default function TitleBar({ onSettings }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow.isMaximized().then(setMaximized);
    appWindow
      .onResized(async () => setMaximized(await appWindow.isMaximized()))
      .then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <img className="brand-logo" src={logoUrl} alt="ZyMono" draggable={false} />
        <span className="titlebar-title">ZyMono</span>
        <span className="titlebar-sub">Mono · IL2CPP — Windows</span>
      </div>

      <div className="titlebar-controls">
        <button className="tb-btn tb-settings" title="Settings" onClick={onSettings}>
          <Settings2 size={15} />
        </button>
        <button className="tb-btn" title="Minimize" onClick={() => appWindow.minimize()}>
          <Minus size={16} strokeWidth={2.2} />
        </button>
        <button
          className="tb-btn"
          title={maximized ? "Restore" : "Maximize"}
          onClick={() => appWindow.toggleMaximize()}
        >
          {maximized ? <Copy size={12} strokeWidth={2.2} /> : <Square size={12} strokeWidth={2.2} />}
        </button>
        <button className="tb-btn tb-close" title="Close" onClick={() => appWindow.close()}>
          <X size={16} strokeWidth={2.2} />
        </button>
      </div>
    </div>
  );
}
