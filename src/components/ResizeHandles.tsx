import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

type RzDir = Parameters<typeof appWindow.startResizeDragging>[0];

const HANDLES: { cls: string; dir: string }[] = [
  { cls: "rz-top", dir: "North" },
  { cls: "rz-bottom", dir: "South" },
  { cls: "rz-left", dir: "West" },
  { cls: "rz-right", dir: "East" },
  { cls: "rz-tl", dir: "NorthWest" },
  { cls: "rz-tr", dir: "NorthEast" },
  { cls: "rz-bl", dir: "SouthWest" },
  { cls: "rz-br", dir: "SouthEast" },
];

export default function ResizeHandles() {
  return (
    <>
      {HANDLES.map((h) => (
        <div
          key={h.cls}
          className={`rz ${h.cls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            appWindow.startResizeDragging(h.dir as unknown as RzDir).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
