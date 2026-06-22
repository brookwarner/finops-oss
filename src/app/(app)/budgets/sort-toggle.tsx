"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PopoverMenu } from "@/components/popover-menu";
import { SortDesc, Check } from "@/components/icons";

export type SortKey = "target" | "pct" | "remaining" | "name";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "target", label: "Size" },
  { key: "pct", label: "% used" },
  { key: "remaining", label: "Left" },
  { key: "name", label: "A–Z" },
];

export function SortToggle({ active }: { active: SortKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  function setSort(sort: SortKey) {
    const params = new URLSearchParams(searchParams.toString());
    if (sort === "target") {
      params.delete("sort");
    } else {
      params.set("sort", sort);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const current = SORTS.find((s) => s.key === active) ?? SORTS[0];

  return (
    <PopoverMenu
      ariaLabel="Sort by"
      icon={<SortDesc className="h-3.5 w-3.5 text-ink-faint" />}
      label={current.label}
      panelClassName="min-w-[8rem]"
    >
      {(close) =>
        SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              setSort(s.key);
              close();
            }}
            className={`flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              active === s.key
                ? "bg-sunken font-medium text-ink-strong"
                : "text-ink-muted hover:bg-sunken"
            }`}
          >
            {s.label}
            {active === s.key && <Check className="h-3.5 w-3.5 text-accent" />}
          </button>
        ))
      }
    </PopoverMenu>
  );
}
