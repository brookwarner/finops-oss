"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PopoverMenu } from "@/components/popover-menu";
import { Calendar } from "@/components/icons";
import { formatDateShort } from "@/lib/format";

// Controlled by the URL: ?from=YYYY-MM-DD&to=YYYY-MM-DD. The page can compute
// a default range (e.g. 20-to-20) if the params are missing. Reset clears them
// so the default reasserts.
function fmt(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return formatDateShort(d);
}

export function DateRangePicker({
  from,
  to,
  // Shown when neither bound is set (e.g. the Transactions page, which has no
  // default cycle — unlike Budgets, which always computes a 20-to-20 range).
  emptyLabel = "All dates",
  resetLabel = "Reset to current cycle",
}: {
  from: string;
  to: string;
  emptyLabel?: string;
  resetLabel?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function pushParam(name: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <PopoverMenu
      ariaLabel="Date range"
      align="right"
      icon={<Calendar className="h-3.5 w-3.5 text-ink-faint" />}
      label={from || to ? `${fmt(from)} – ${fmt(to)}` : emptyLabel}
      labelClassName="hidden whitespace-nowrap sm:inline"
      panelClassName="w-60 p-3"
    >
      {(close) => (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => pushParam("from", e.target.value || null)}
              className="rounded-control border border-hairline px-2 py-1 text-xs font-normal normal-case tracking-normal text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => pushParam("to", e.target.value || null)}
              className="rounded-control border border-hairline px-2 py-1 text-xs font-normal normal-case tracking-normal text-ink"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              reset();
              close();
            }}
            className="rounded-control border border-hairline bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-sunken"
          >
            {resetLabel}
          </button>
        </div>
      )}
    </PopoverMenu>
  );
}
