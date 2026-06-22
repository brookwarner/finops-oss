"use client";
import { useState, useTransition } from "react";
import { SPEND_CLASSES, SPEND_CLASS_LABEL, type SpendClass } from "@/lib/spend/classify";
import { setSpendClassAction } from "./actions";

/**
 * Inline classifier for one spend category. A native <select> (best mobile UX)
 * that saves on change. Mirrors the income-type editor.
 */
export function SpendClassEditor({
  categoryId,
  spendClass,
}: {
  categoryId: string;
  spendClass: SpendClass;
}) {
  const [value, setValue] = useState<SpendClass>(spendClass);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(next: SpendClass) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      try {
        await setSpendClassAction(categoryId, next);
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
        onChange={(e) => onChange(e.target.value as SpendClass)}
        className="w-full rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-ink disabled:opacity-50"
      >
        {SPEND_CLASSES.map((c) => (
          <option key={c} value={c}>
            {SPEND_CLASS_LABEL[c]}
          </option>
        ))}
      </select>
      {pending && <p className="mt-1.5 text-[11px] text-ink-faint">Saving…</p>}
      {error && <p className="mt-1 text-[11px] text-negative">{error}</p>}
    </div>
  );
}
