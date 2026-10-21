"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/format";
import type { CashAccountState } from "@/lib/cash-allocations/compute";

const inputClass = "w-full rounded-lg border border-hairline bg-bg px-3 py-2 text-sm";

export function CashAllocationEditor({ account: a }: { account: CashAccountState }) {
  const router = useRouter();
  const [revision, setRevision] = useState(a.config.revision);
  const [businessCash, setBusinessCash] = useState(a.config.businessCash);
  const [whole, setWhole] = useState(Boolean(a.config.wholeAccountLabel));
  const [wholeLabel, setWholeLabel] = useState(a.config.wholeAccountLabel ?? "Tax");
  const [pots, setPots] = useState(a.config.pots.map((p) => ({ label: p.label, amount: String(p.amount) })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(e: FormEvent, clear = false) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (!clear && !whole && pots.some((p) => !p.amount.trim() || !Number.isFinite(Number(p.amount)))) throw new Error("Enter an amount for each allocation.");
      const response = await fetch("/api/cash-allocations", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: a.accountId, revision, businessCash: clear ? false : businessCash, wholeAccountLabel: !clear && whole ? wholeLabel : null,
          pots: clear || whole ? [] : pots.map((p) => ({ label: p.label, amount: Number(p.amount) })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.issues?.[0]?.message ?? body.error ?? "Could not save allocations");
      setRevision(body.config.revision); setMessage("Saved"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <details className="rounded-row bg-surface p-4 shadow-row">
    <summary className="cursor-pointer text-sm">
      <span className="font-semibold">{a.name}</span>
      {a.unavailableReason ? <span className="mt-1 block text-xs text-negative">{a.unavailableReason}</span> : <span className="mt-1 block text-xs text-ink-muted">{formatCurrency(a.balance)} cash · {formatCurrency(a.protected)} set aside · {formatCurrency(a.unallocated)} unallocated</span>}
      {!a.unavailableReason && a.shortfall > 0 && <span className="mt-1 block text-xs text-negative">{formatCurrency(a.shortfall)} allocation shortfall</span>}
    </summary>
    <form onSubmit={(e) => save(e)} className="mt-4 space-y-3">
      {a.unavailableReason && a.config.revision !== null && <button type="button" disabled={busy} className="text-sm text-negative underline" onClick={(e) => save(e, true)}>Clear saved plan for this account</button>}
      <fieldset disabled={busy || Boolean(a.unavailableReason)} className="space-y-3 disabled:opacity-60">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={businessCash} onChange={(e) => setBusinessCash(e.target.checked)} />Include in business cash available to pay yourself</label>
        {a.existingProtection ? <p className="text-sm text-ink-muted">Already protected: {a.existingProtection}. This account&apos;s cash is set aside once.</p> : <>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />Protect the whole account</label>
          {whole ? <label className="block text-xs">Purpose<input className={`${inputClass} mt-1`} value={wholeLabel} required maxLength={80} onChange={(e) => setWholeLabel(e.target.value)} /></label> : <>
            {pots.map((p, i) => <div key={i} className="flex items-end gap-2">
              <label className="min-w-0 flex-1 text-xs">Purpose<input className={`${inputClass} mt-1`} value={p.label} required maxLength={80} placeholder="Income tax" onChange={(e) => setPots(pots.map((v, j) => j === i ? { ...v, label: e.target.value } : v))} /></label>
              <label className="w-28 shrink-0 text-xs">NZD<input className={`${inputClass} mt-1`} type="number" inputMode="decimal" min="0" max="999999999" step="0.01" required value={p.amount} onChange={(e) => setPots(pots.map((v, j) => j === i ? { ...v, amount: e.target.value } : v))} /></label>
              <button type="button" aria-label={`Remove ${p.label || "allocation"}`} className="px-2 py-2 text-sm text-negative" onClick={() => setPots(pots.filter((_, j) => j !== i))}>×</button>
            </div>)}
            <button type="button" disabled={pots.length >= 30} className="text-sm text-accent underline" onClick={() => setPots([...pots, { label: "", amount: "" }])}>Add allocation</button>
            <p className="text-xs text-ink-faint">For example: Income tax, GST, Upcoming costs, Operating buffer.</p>
          </>}
        </>}
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">{busy ? "Saving…" : "Save allocations"}</button>
      </fieldset>
      {message && <p role="status" className="text-sm text-positive">{message}</p>}
      {error && <p role="alert" className="text-sm text-negative">{error} <button type="button" className="underline" onClick={() => router.refresh()}>Reload</button></p>}
      <p className="text-xs text-ink-faint">Balance updated: {a.balanceUpdatedAt ? new Date(a.balanceUpdatedAt).toLocaleString("en-NZ", { timeZone: "Pacific/Auckland" }) : "date unavailable"}. Refresh bank accounts if this looks stale.</p>
    </form>
  </details>;
}
