export interface EntryParts {
  namespace: string;
  className: string;
  method: string;
}

const IDENT = /^[A-Za-z_@][A-Za-z0-9_`+<>,[\]]*$/;
const FILE_EXT = /^(dll|exe|pdb|cs|json|txt|xml|config|ini|log|zip|md)$/i;

export function normalizeEntryToken(raw: string): string {
  let s = raw.trim();
  if (!s) return "";

  const paren = s.indexOf("(");
  if (paren >= 0) s = s.slice(0, paren);

  if (/[\\/]/.test(s)) return "";

  s = s.replace(/::/g, ".").replace(/:/g, ".");

  return (s.trim().split(/\s+/).pop() ?? "").replace(/^\.+|\.+$/g, "");
}

export function splitEntryPoint(raw: string): EntryParts | null {
  const parts = normalizeEntryToken(raw)
    .split(".")
    .map((t) => t.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  if (!parts.every((t) => IDENT.test(t))) return null;
  if (FILE_EXT.test(parts[parts.length - 1])) return null;

  return {
    namespace: parts.slice(0, -2).join("."),
    className: parts[parts.length - 2],
    method: parts[parts.length - 1],
  };
}
