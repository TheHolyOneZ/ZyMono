import { useMemo, useState, useRef, useEffect } from "react";
import {
  Search,
  Star,
  Syringe,
  MoreVertical,
  Copy,
  Trash2,
  Pencil,
  BookMarked,
  ShieldCheck,
  Zap,
  Cable,
  Upload,
  Download,
} from "lucide-react";
import type { InjectMethod, MonoProcess, Profile } from "../types";
import { matchTarget, sortProfiles } from "../profiles";
import { basename } from "../path";
import MenuPopup from "./MenuPopup";

interface Props {
  profiles: Profile[];
  targets: MonoProcess[];
  activeId: string | null;
  onLoad: (p: Profile) => void;
  onInject: (p: Profile, target: MonoProcess) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onToggleAutoInject: (id: string) => void;
  onImport: () => void;
  onExport: () => void;
}

const methodIcon: Record<InjectMethod, JSX.Element> = {
  auto: <ShieldCheck size={11} />,
  direct: <Zap size={11} />,
  pipe: <Cable size={11} />,
};

export default function ProfilesList({
  profiles,
  targets,
  activeId,
  onLoad,
  onInject,
  onRename,
  onDelete,
  onDuplicate,
  onToggleFavorite,
  onToggleAutoInject,
  onImport,
  onExport,
}: Props) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? profiles.filter((p) =>
          `${p.name} ${p.gameName ?? ""} ${p.className}.${p.method} ${p.dllPath ?? ""}`
            .toLowerCase()
            .includes(q)
        )
      : profiles;
    return sortProfiles(filtered);
  }, [profiles, query]);

  const startRename = (p: Profile) => {
    setRenaming(p.id);
    setDraft(p.name);
    setMenu(null);
  };
  const commitRename = () => {
    if (renaming) {
      const name = draft.trim();
      if (name) onRename(renaming, name);
    }
    setRenaming(null);
  };

  return (
    <div className="sidebar-inner">
      <div className="profiles-head">
        <div className="search-box small">
          <Search size={13} />
          <input
            type="text"
            placeholder="Search profiles…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="profiles-tools">
          <button className="text-btn" onClick={onExport} title="Export all profiles to a file">
            <Upload size={13} /> Export
          </button>
          <button className="text-btn" onClick={onImport} title="Import profiles from a file">
            <Download size={13} /> Import
          </button>
        </div>
      </div>

      <div className="proc-scroll">
        {profiles.length === 0 ? (
          <div className="empty-hint">
            <BookMarked size={24} strokeWidth={1.6} />
            <span>No profiles yet</span>
            <small>Set up an injection and hit Save to store it here.</small>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty-hint">
            <Search size={22} strokeWidth={1.6} />
            <span>No matches</span>
          </div>
        ) : (
          shown.map((p) => {
            const target = matchTarget(p, targets);
            const live = !!target;
            const dll = p.dllPath ? basename(p.dllPath) : "no DLL";
            return (
              <div
                key={p.id}
                className={`profile-card${live ? " live" : " dim"}${activeId === p.id ? " active" : ""}`}
                onClick={() => renaming !== p.id && onLoad(p)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, id: p.id });
                }}
              >
                <div className="pc-top">
                  <button
                    className={`pc-star${p.favorite ? " on" : ""}`}
                    title={p.favorite ? "Unfavorite" : "Favorite"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(p.id);
                    }}
                  >
                    <Star size={13} fill={p.favorite ? "currentColor" : "none"} />
                  </button>
                  {renaming === p.id ? (
                    <input
                      ref={renameRef}
                      className="pc-rename"
                      value={draft}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <span className="pc-name" onDoubleClick={(e) => { e.stopPropagation(); startRename(p); }}>
                      {p.name}
                    </span>
                  )}
                  <span className={`pc-method ${p.methodMode}`} title={`Route: ${p.methodMode}`}>
                    {methodIcon[p.methodMode]}
                    {p.methodMode}
                  </span>
                </div>

                <div className="pc-meta">
                  {(p.gameName ?? "Any game")}
                  {(p.className || p.method) && (
                    <> · <span className="pc-entry">{[p.className, p.method].filter(Boolean).join(".")}</span></>
                  )}
                </div>
                <div className="pc-dll">{dll}</div>

                <div className="pc-actions">
                  {live ? (
                    <button
                      className="pc-inject"
                      title={`Inject into ${target!.name} (PID ${target!.pid})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onInject(p, target!);
                      }}
                    >
                      <Syringe size={13} /> Inject
                    </button>
                  ) : (
                    <span className="pc-status">not running</span>
                  )}
                  {p.autoInject && (
                    <span className="pc-auto-on" title="Auto-injects when this game launches">
                      <Zap size={11} /> auto
                    </span>
                  )}
                  <button
                    className="pc-more"
                    title="More…"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMenu({ x: r.right, y: r.bottom, id: p.id });
                    }}
                  >
                    <MoreVertical size={15} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {menu && (
        <MenuPopup
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Rename",
              icon: <Pencil size={14} />,
              onClick: () => {
                const p = profiles.find((x) => x.id === menu.id);
                if (p) startRename(p);
              },
            },
            { label: "Duplicate", icon: <Copy size={14} />, onClick: () => onDuplicate(menu.id) },
            {
              label: profiles.find((x) => x.id === menu.id)?.autoInject
                ? "Disable auto-inject"
                : "Auto-inject on launch",
              icon: <Zap size={14} />,
              onClick: () => onToggleAutoInject(menu.id),
            },
            {
              label: "Delete",
              icon: <Trash2 size={14} />,
              danger: true,
              sep: true,
              onClick: () => onDelete(menu.id),
            },
          ]}
        />
      )}
    </div>
  );
}
