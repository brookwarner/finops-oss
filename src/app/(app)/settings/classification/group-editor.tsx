"use client";
import { useState, useTransition } from "react";
import { setCategoryGroupAction } from "./actions";

const NEW = "__new__";
const NONE = "__none__";

/**
 * Inline group picker for one spend category. A native <select> of the groups the
 * household already uses (best mobile UX, saves on change), plus "New group…" which
 * reveals a text field so a group can be coined without leaving the row.
 *
 * Groups are presentation only — the /budgets list sections by them — so a wrong
 * pick costs nothing but a re-pick. Mirrors the spend-class editor beside it.
 */
export function GroupEditor({
  categoryId,
  group,
  groups,
}: {
  categoryId: string;
  group: string | null;
  groups: string[];
}) {
  const [value, setValue] = useState<string | null>(group);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A group set elsewhere (or coined here) may not be in the household list yet.
  const options = groups.includes(value ?? "") || !value ? groups : [...groups, value];

  function save(next: string | null) {
    const prev = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      try {
        await setCategoryGroupAction(categoryId, next);
      } catch (e) {
        setValue(prev); // roll back the optimistic change
        setError(e instanceof Error ? e.message : "Couldn't save");
      }
    });
  }

  function onSelect(raw: string) {
    if (raw === NEW) {
      setCreating(true);
      return;
    }
    setCreating(false);
    save(raw === NONE ? null : raw);
  }

  function commitNew() {
    const next = draft.trim();
    setCreating(false);
    setDraft("");
    if (next) save(next);
  }

  return (
    <div className="mt-2">
      <label className="mb-1 block text-[11px] uppercase tracking-wide text-ink-faint">
        Group
      </label>
      {creating ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={draft}
            maxLength={40}
            placeholder="New group name"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNew();
              if (e.key === "Escape") {
                setCreating(false);
                setDraft("");
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-ink"
          />
          <button
            type="button"
            onClick={commitNew}
            className="shrink-0 rounded-md border border-hairline px-3 py-2 text-sm font-semibold text-ink"
          >
            Save
          </button>
        </div>
      ) : (
        <select
          value={value ?? NONE}
          disabled={pending}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-md border border-hairline bg-surface px-2.5 py-2 text-sm text-ink disabled:opacity-50"
        >
          <option value={NONE}>No group</option>
          {options.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
          <option value={NEW}>New group…</option>
        </select>
      )}
      {pending && <p className="mt-1.5 text-[11px] text-ink-faint">Saving…</p>}
      {error && <p className="mt-1 text-[11px] text-negative">{error}</p>}
    </div>
  );
}
