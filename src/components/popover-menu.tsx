"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "./icons";

// A compact toolbar control: a pill trigger (icon + label + chevron) that opens
// a floating panel. Used for the Group / Sort dropdowns and the date-range
// popover. Outside clicks close it via a full-viewport transparent backdrop.
export function PopoverMenu({
  icon,
  label,
  labelClassName,
  align = "left",
  panelClassName = "",
  ariaLabel,
  children,
}: {
  icon?: ReactNode;
  label?: ReactNode;
  labelClassName?: string;
  align?: "left" | "right";
  panelClassName?: string;
  ariaLabel?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          open
            ? "border-hairline bg-sunken text-ink-strong"
            : "border-hairline bg-surface text-ink-muted hover:bg-sunken hover:text-ink"
        }`}
      >
        {icon}
        {label != null && <span className={labelClassName}>{label}</span>}
        <ChevronDown className="h-3 w-3 text-ink-faint" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden="true" />
          <div
            className={`absolute z-30 mt-1.5 rounded-control border border-hairline bg-surface p-1 shadow-pop ${
              align === "right" ? "right-0" : "left-0"
            } ${panelClassName}`}
          >
            {children(close)}
          </div>
        </>
      )}
    </div>
  );
}
