"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info } from "./icons";

// The canonical info affordance across the app: an ⓘ trigger that opens a
// touch-first bottom sheet. One pattern, one set of open/dismiss handling (tap
// to open; backdrop, Done button, or Escape to close) for every "what does this
// mean?" explainer — the old hover bubble (InfoTip) and the per-card explainer
// sheet have been folded into this.
//
// Portalled to <body> so it overlays the bottom-nav (which sits at z-20).
// `title`/`answers` render the sheet header; `children` is the body — prose for
// a quick hint, or a structured legend for a hero card. The trigger calls
// preventDefault/stopPropagation so it's safe inside a <Link>-wrapped card.
export function InfoSheet({
  title,
  answers,
  children,
  ariaLabel,
  triggerClassName = "",
}: {
  title?: string;
  answers?: string;
  children: ReactNode;
  ariaLabel?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel ?? (title ? `Explain: ${title}` : "More info")}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={`-m-1.5 inline-flex shrink-0 items-center justify-center rounded-full p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink-muted active:bg-sunken ${triggerClassName}`}
      >
        <Info className="h-4 w-4" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50"
            role="dialog"
            aria-modal="true"
            aria-label={title ?? ariaLabel ?? "More info"}
          >
            {/* Dim, tap-to-dismiss backdrop. */}
            <div
              className="absolute inset-0 bg-ink/40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            {/* Bottom-anchored panel — rounded top corners, grab handle, safe-area pad. */}
            <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-card border-t border-hairline bg-surface px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-pop">
              {/* Grab handle. */}
              <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-hairline" aria-hidden="true" />

              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  {title && (
                    <h2 className="text-lg font-semibold text-ink-strong">{title}</h2>
                  )}
                  {answers && (
                    <p className="mt-1 text-sm font-medium text-accent">{answers}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="-mr-1 -mt-0.5 shrink-0 rounded-control px-2 py-1 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
                >
                  Done
                </button>
              </div>

              {children}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
