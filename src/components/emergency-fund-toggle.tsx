"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Designate a liquid account as the household's emergency fund and set its
 *  target in months of total spend. Mirrors RevolvingToggle; adds the months
 *  input shown once designated. */
export function EmergencyFundToggle({
  akahuAccountId, initial, initialMonths,
}: { akahuAccountId: string; initial: boolean; initialMonths: number }) {
  const [on, setOn] = useState(initial);
  const [months, setMonths] = useState(initialMonths || 4);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save(value: boolean | undefined, targetMonths: number) {
    setSaving(true);
    const res = await fetch("/api/accounts/emergency-fund", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ akahuAccountId, value, targetMonths }),
    });
    setSaving(false);
    // The designation + target drive the emergency-fund readout on other tabs.
    // Refresh the client Router Cache or their prefetched payloads stay stale
    // for staleTimes.static (300s). See tests/app/router-refresh-guard.test.ts.
    if (res.ok) router.refresh();
    return res.ok;
  }

  async function toggle() {
    const next = !on;
    setOn(next); // optimistic
    if (!(await save(next, months))) setOn(!next); // revert on failure
  }

  async function changeMonths(m: number) {
    setMonths(m);
    if (on) await save(true, m); // persist only while designated
  }

  return (
    <div className="mt-2 text-xs text-ink-muted">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={on} disabled={saving} onChange={toggle} className="h-4 w-4 accent-accent" />
        <span>Emergency fund — track this account against a cash-buffer target (months of total spend).</span>
      </label>
      {on && (
        <div className="ml-6 mt-1.5 flex items-center gap-2">
          <span>Target</span>
          <input
            type="number" min={1} max={24} value={months} disabled={saving}
            onChange={(e) => changeMonths(Math.min(24, Math.max(1, Number(e.target.value) || 1)))}
            className="w-14 rounded-md border border-hairline bg-sunken px-2 py-1 text-right tabular-nums text-ink outline-none"
          />
          <span>months of spend</span>
        </div>
      )}
    </div>
  );
}
