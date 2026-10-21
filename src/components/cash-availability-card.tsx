import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { CashAvailability } from "@/lib/cash-allocations/compute";

export function CashAvailabilityCard({ state }: { state: CashAvailability }) {
  const b = state.business;
  return <div className="mb-5 rounded-row bg-surface p-5 shadow-row">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">Available to pay yourself</h2>
      <Link href="/cash-allocations" className="text-xs text-accent underline">Cash allocations</Link>
    </div>
    {state.issues.map((issue) => <p key={issue} role="alert" className="mt-2 text-sm text-negative">{issue}</p>)}
    {b.configured ? <>
      <p className="mt-2 text-3xl font-bold tabular-nums">{b.availableToDraw === null ? "Unavailable" : formatCurrency(b.availableToDraw)}</p>
      {b.availableToDraw !== null && <p className="mt-1 text-xs text-ink-muted">{formatCurrency(b.cash)} business cash − {formatCurrency(b.protected)} set aside</p>}
      {b.availableToDraw !== null && b.shortfall > 0 && <p className="mt-2 text-sm text-negative">{formatCurrency(b.shortfall)} short of covering your allocations.</p>}
      <p className="mt-2 text-xs text-ink-faint">Based on saved allocations and latest bank balances. Set aside upcoming costs and a buffer before drawing money. Unpaid invoices and credit are excluded.</p>
    </> : <p className="mt-2 text-sm text-ink-muted">Choose your business cash accounts and set money aside for tax, costs and a buffer.</p>}
  </div>;
}
