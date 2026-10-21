"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { PopoverMenu } from "@/components/popover-menu";
import { Layers, Check } from "@/components/icons";

export type DisplayMode = "category" | "type" | "flow";

const MODES: { key: DisplayMode; label: string }[] = [
  { key: "category", label: "Category" },
  { key: "type", label: "Type" },
  { key: "flow", label: "Flow" },
];

export function ModeToggle({ active }: { active: DisplayMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  function setMode(mode: DisplayMode) {
    const params = new URLSearchParams(searchParams.toString());
    if (mode === "category") {
      params.delete("mode");
    } else {
      params.set("mode", mode);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const current = MODES.find((m) => m.key === active) ?? MODES[0];

  return (
    <PopoverMenu
      ariaLabel="Group by"
      icon={<Layers className="h-3.5 w-3.5 text-ink-faint" />}
      label={current.label}
      panelClassName="min-w-[8rem]"
    >
      {(close) =>
        MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setMode(m.key);
              close();
            }}
            className={`flex w-full items-center justify-between gap-4 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors ${
              active === m.key
                ? "bg-sunken font-medium text-ink-strong"
                : "text-ink-muted hover:bg-sunken"
            }`}
          >
            {m.label}
            {active === m.key && <Check className="h-3.5 w-3.5 text-accent" />}
          </button>
        ))
      }
    </PopoverMenu>
  );
}
