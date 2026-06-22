"use client";
import { useState } from "react";

export function RevolvingToggle({ akahuAccountId, initial }: { akahuAccountId: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !on;
    setSaving(true);
    setOn(next); // optimistic
    const res = await fetch("/api/accounts/revolving", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ akahuAccountId, value: next }),
    });
    setSaving(false);
    if (!res.ok) setOn(!next); // revert on failure
  }

  return (
    <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
      <input type="checkbox" checked={on} disabled={saving} onChange={toggle} className="h-4 w-4 accent-accent" />
      <span>Revolving facility — counts undrawn credit/overdraft headroom as runway in the cashflow forecast.</span>
    </label>
  );
}
