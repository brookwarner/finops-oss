import { formatCurrency } from "@/lib/format";
import type { SweepNudge } from "@/lib/reserves/nudge";

const money = (n: number) => formatCurrency(n, { decimals: 0 });

export function SweepNudgeCard({
  nudge,
  bufferConfigured,
}: {
  nudge: SweepNudge;
  bufferConfigured: boolean;
}) {
  // Nothing to sweep this cycle (no behind reserves / no surplus routed to them)
  // → hide entirely, before prompting to set up a buffer for a non-existent sweep.
  if (nudge.recommended <= 0) return null;

  if (!bufferConfigured) {
    return (
      <section className="mb-3 rounded-card bg-surface p-5 shadow-card">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Sweep your spare
        </span>
        <p className="mt-2 text-[13px] text-ink-muted">
          Designate a reserve buffer account (a dedicated savings account with a transaction feed)
          to turn the surplus cascade into a tracked sweep.
        </p>
      </section>
    );
  }

  if (nudge.cleared) {
    return (
      <section className="mb-3 rounded-card bg-surface p-5 shadow-card">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Sweep your spare
        </span>
        <p className="mt-2 text-[15px] font-semibold text-positive">
          Swept {money(nudge.sweptThisCycle)} to your buffer this cycle ✓
        </p>
      </section>
    );
  }

  const billsLabel = nudge.billsDate ? dayOrdinal(nudge.billsDate) : null;

  // Cash-blocked: the plan says there's spare, but the forecast trough shows
  // moving anything now would dip below the bills-day cushion. Hold off — don't
  // show a "$0 to move" prompt. Surfaces the outstanding plan gap as "later".
  if (nudge.remaining <= 0 && nudge.outstanding > 0) {
    return (
      <section className="mb-3 rounded-card bg-surface p-5 shadow-card">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Sweep your spare
        </span>
        <p className="mt-2 text-[13px] text-ink-muted">
          Hold off — sweeping now would dip below your bills-day cushion
          {billsLabel ? ` (the ${billsLabel})` : ""}.
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">
          {money(nudge.outstanding)} spare to sweep once your income lands.
        </p>
      </section>
    );
  }

  const covers = nudge.perReserve
    .map((r) => `${r.category} (${money(r.covers)})`)
    .join(" · ");
  const leftover = nudge.billsBalance != null ? nudge.billsBalance - nudge.remaining : null;

  return (
    <section className="mb-3 rounded-card bg-surface p-5 shadow-card">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Sweep your spare
      </span>
      <div className="mt-1.5 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-[26px] font-bold tabular-nums leading-none text-ink">
            {money(nudge.remaining)}
          </span>
          <span className="text-[12px] text-ink-muted">move to your buffer</span>
        </div>
        <div className="space-y-0.5 text-[11px] text-ink-faint sm:text-right">
          {leftover != null && billsLabel && (
            <p>
              Leaves {money(leftover)} for bills on the {billsLabel}
            </p>
          )}
          {nudge.cashCapped && nudge.outstanding > nudge.remaining ? (
            <p>{money(nudge.outstanding - nudge.remaining)} more once payday lands</p>
          ) : (
            covers && <p>Covers {covers}</p>
          )}
          {nudge.sweptThisCycle > 0 && (
            <p>{money(nudge.sweptThisCycle)} already swept this cycle</p>
          )}
        </div>
      </div>
    </section>
  );
}

function dayOrdinal(isoDate: string): string {
  const day = Number(isoDate.slice(8, 10));
  const suffix =
    day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}
