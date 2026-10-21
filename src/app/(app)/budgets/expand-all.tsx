"use client";

import { useState } from "react";
import { ChevronsExpand, ChevronsCollapse } from "@/components/icons";

export function ExpandAllToggle() {
  const [allOpen, setAllOpen] = useState(false);

  function toggle() {
    const next = !allOpen;
    document.querySelectorAll<HTMLDetailsElement>("details[data-budget-row]").forEach((d) => {
      d.open = next;
    });
    setAllOpen(next);
  }

  const label = allOpen ? "Collapse all" : "Expand all";

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center rounded-control border border-hairline bg-surface p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
    >
      {allOpen ? (
        <ChevronsCollapse className="h-4 w-4" />
      ) : (
        <ChevronsExpand className="h-4 w-4" />
      )}
    </button>
  );
}
