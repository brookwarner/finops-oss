"use client";
import { useState, useTransition } from "react";
import { INCOME_TYPES, INCOME_TYPE_LABEL, INCOME_TYPE_HELP, type IncomeType } from "@/lib/income/classify";
import { setIncomeTypeAction } from "./actions";

/**
 * Inline classifier for one income source. A native <select> (best mobile UX) that
 * saves on change. The help text under it explains what the chosen type does.
 */
export function IncomeTypeEditor({
  categoryId,
  incomeType,
}: {
  categoryId: string;
  incomeType: IncomeType;
}) {
  const [value, setValue] = useState<IncomeType>(incomeType);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(next: IncomeType) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      try {
        await setIncomeTypeAction(categoryId, next);
      } catch (e) {
        setValue(prev); // roll back the optimistic change
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  return (
    <div className="mt-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as IncomeType)}
        className="w-full rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-ink disabled:opacity-50"
      >
        {INCOME_TYPES.map((t) => (
          <option key={t} value={t}>
            {INCOME_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        {pending ? "Saving…" : INCOME_TYPE_HELP[value]}
      </p>
      {error && <p className="mt-1 text-[11px] text-negative">{error}</p>}
    </div>
  );
}
