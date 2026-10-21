import { formatCurrency } from "@/lib/format";
import type { SweepNudge } from "@/lib/reserves/nudge";

const money = (n: number) => formatCurrency(n, { decimals: 0 });

function dayOrdinal(isoDate: string): string {
  const day = Number(isoDate.slice(8, 10));
  const suffix =
    day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

/** Fire when there's a cash-safe sweep this cycle and we haven't nudged yet. When
 *  the forecast says there's no safe headroom (cash-blocked before payday/bills),
 *  `remaining` is 0 and we stay quiet — the nudge self-defers to when it's safe. */
export function decideSweepNudge(nudge: SweepNudge, alreadyFiredThisCycle: boolean): boolean {
  return !alreadyFiredThisCycle && nudge.remaining > 0;
}

/** One-line standalone Telegram message for the cycle sweep nudge. States the
 *  cash left for bills day when a forecast is available, and the deferred
 *  remainder when the sweep is cash-capped rather than plan-capped. */
export function formatSweepNudge(nudge: SweepNudge): string {
  // Everyday cash left on bills day *after* this sweep — the confidence figure.
  const leftover =
    nudge.billsBalance != null && nudge.billsDate
      ? ` — leaves ${money(nudge.billsBalance - nudge.remaining)} for bills on the ${dayOrdinal(nudge.billsDate)}`
      : "";

  if (nudge.cashCapped) {
    const more = Math.max(0, Math.round((nudge.outstanding - nudge.remaining) * 100) / 100);
    const tail = more > 0 ? ` ${money(more)} more to sweep once payday lands.` : "";
    return `💰 Sweep ${money(nudge.remaining)} into your reserve buffer now${leftover}.${tail}`;
  }

  const covers = nudge.perReserve.map((r) => `${r.category} ${money(r.covers)}`).join(", ");
  const tail = covers ? ` (covers ${covers})` : "";
  return `💰 Sweep ${money(nudge.remaining)} into your reserve buffer${leftover}${tail}`;
}
