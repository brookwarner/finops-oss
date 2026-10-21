"use client";
import { useState, useTransition } from "react";
import { formatDateFull } from "@/lib/format";
import { setInceptionAction } from "./actions";

/**
 * Inline "investing since" date control inside an account's expanded panel.
 * Seeds the annualised-return CAGR for holdings that predate observation. A
 * manual date wins over the auto-observed one; clearing it falls back to auto.
 */
export function InceptionEditor({
  accountId,
  inception,
  inceptionSource,
}: {
  accountId: string;
  inception: string | null;
  inceptionSource: "manual" | "observed" | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(inception ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(date: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await setInceptionAction(accountId, date);
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  if (!editing) {
    // Nudge the user to seed a date when annualisation is blocked for want of one.
    const prompt = inceptionSource === null && !inception;
    return (
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-faint">
        <span>
          {inception ? (
            <>
              Investing since {formatDateFull(inception)}
              {inceptionSource === "observed" && " (auto)"}
            </>
          ) : (
            "Set an investing-since date to see annualised growth"
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            setValue(inception ?? "");
            setEditing(true);
          }}
          className="font-semibold text-accent underline-offset-2 hover:underline"
        >
          {prompt ? "Set date" : "Edit"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
      <input
        type="date"
        value={value}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="rounded-md border border-hairline bg-surface px-2 py-1 text-ink"
      />
      <button
        type="button"
        onClick={() => save(value || null)}
        disabled={pending || !value}
        className="rounded-md bg-accent px-2.5 py-1 font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {inceptionSource === "manual" && (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={pending}
          className="font-medium text-ink-faint underline-offset-2 hover:underline"
        >
          Clear
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        disabled={pending}
        className="font-medium text-ink-faint underline-offset-2 hover:underline"
      >
        Cancel
      </button>
      {error && <span className="w-full text-negative">{error}</span>}
    </div>
  );
}
