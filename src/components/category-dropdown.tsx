"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Group colour palette — same one used elsewhere; duplicated here to keep
// this component self-contained.
const GROUP_COLORS: Record<string, { bg: string; fg: string }> = {
  Income:        { bg: "#dcfce7", fg: "#14532d" },
  Food:          { bg: "#fed7aa", fg: "#7c2d12" },
  Discretionary: { bg: "#fce7f3", fg: "#831843" },
  Kids:          { bg: "#ede9fe", fg: "#4c1d95" },
  Wellbeing:     { bg: "#d1fae5", fg: "#064e3b" },
  Transit:       { bg: "#e0f2fe", fg: "#0c4a6e" },
  Maintenance:   { bg: "#fef3c7", fg: "#78350f" },
  Utilities:     { bg: "#cffafe", fg: "#164e63" },
  Fixed:         { bg: "#e2e8f0", fg: "#1e293b" },
  Mortgage:      { bg: "#e0e7ff", fg: "#312e81" },
  Investments:   { bg: "#ecfccb", fg: "#365314" },
  Savings:       { bg: "#dcfce7", fg: "#14532d" },
  Business:      { bg: "#fee2e2", fg: "#7f1d1d" },
  System:        { bg: "#f1f5f9", fg: "#475569" },
};

function styleFor(group: string | null) {
  const c = GROUP_COLORS[group ?? ""];
  return c ? { backgroundColor: c.bg, color: c.fg } : {};
}

export type Cat = { id: string; name: string; group: string | null };

export function CategoryDropdown({
  value,
  categories,
  onChange,
  disabled,
  placeholder = "Uncategorised",
}: {
  value: string | null;
  categories: Cat[];
  onChange: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
  } | null>(null);

  // The menu is rendered in a portal (so no overflow-clipping ancestor — e.g.
  // the transactions table's `overflow-x-auto` wrapper — can cut it off), which
  // means it's positioned with viewport-relative `fixed` coordinates measured
  // from the trigger button.
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function place() {
      const btn = ref.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const width = Math.min(256, window.innerWidth - 2 * margin); // 16rem, capped to viewport
      const left = Math.min(Math.max(margin, r.left), window.innerWidth - width - margin);

      // Flip upward when there isn't room below and there's more room above.
      const spaceBelow = window.innerHeight - r.bottom - gap - margin;
      const spaceAbove = r.top - gap - margin;
      const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(320, Math.max(openUp ? spaceAbove : spaceBelow, 96));

      setMenuPos(
        openUp
          ? { left, width, maxHeight, bottom: window.innerHeight - r.top + gap }
          : { left, width, maxHeight, top: r.bottom + gap },
      );
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = categories.find((c) => c.id === value) ?? null;

  // Group + filter.
  const f = filter.toLowerCase().trim();
  const byGroup = new Map<string, Cat[]>();
  for (const c of categories) {
    if (f && !c.name.toLowerCase().includes(f) && !(c.group ?? "").toLowerCase().includes(f)) {
      continue;
    }
    const g = c.group ?? "Other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(c);
  }

  return (
    <div ref={ref} className="relative inline-block text-sm">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="flex min-w-[10rem] items-center justify-between gap-2 rounded-control border border-hairline bg-surface px-2 py-1 text-left text-ink disabled:opacity-50"
        style={selected ? styleFor(selected.group) : {}}
      >
        <span className="truncate">{selected ? selected.name : placeholder}</span>
        <span className="text-xs opacity-60">▾</span>
      </button>
      {open && menuPos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-50 overflow-auto rounded-control border border-hairline bg-surface text-sm shadow-pop"
            style={{
              top: menuPos.top,
              bottom: menuPos.bottom,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: menuPos.maxHeight,
            }}
          >
          <div className="sticky top-0 border-b border-hairline bg-surface p-2">
            <input
              autoFocus
              type="search"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full rounded-control border border-hairline bg-surface px-2 py-1 text-sm text-ink placeholder:text-ink-faint"
            />
          </div>
          <ul>
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  setFilter("");
                }}
                className="block w-full px-2 py-1.5 text-left text-ink-muted hover:bg-sunken"
              >
                Uncategorised
              </button>
            </li>
            {Array.from(byGroup.entries()).map(([group, cats]) => (
              <li key={group}>
                <div
                  className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide"
                  style={styleFor(group)}
                >
                  {group}
                </div>
                <ul>
                  {cats.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(c.id);
                          setOpen(false);
                          setFilter("");
                        }}
                        className={`block w-full px-3 py-1.5 text-left hover:brightness-95 ${
                          c.id === value ? "font-medium" : ""
                        }`}
                        style={styleFor(group)}
                      >
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
