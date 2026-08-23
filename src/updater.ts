

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
  raw: Update;
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
    raw: update,
  };
}

export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (pct: number | null) => void
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await info.raw.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(total ? 0 : null);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total ? Math.round((downloaded / total) * 100) : null);
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });
  await relaunch();
}
