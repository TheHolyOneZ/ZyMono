const KEY = "zymono.recentDlls";
const MAX = 5;

export function loadRecentDlls(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentDll(path: string): string[] {
  if (!path) return loadRecentDlls();
  const lower = path.toLowerCase();
  const next = [path, ...loadRecentDlls().filter((p) => p.toLowerCase() !== lower)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {

  }
  return next;
}

export function forgetRecentDll(path: string): string[] {
  const lower = path.toLowerCase();
  const next = loadRecentDlls().filter((p) => p.toLowerCase() !== lower);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {

  }
  return next;
}
