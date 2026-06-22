import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { Position } from "@/lib/budgets/position";
import { spendingVsPlanGeometry } from "@/lib/budgets/spending-vs-plan-geometry";
import { ExplainerTrigger } from "@/components/explainer-trigger";
import { explainSpendingVsPlan } from "@/lib/explainers/budget-hero";

// Card 4: the nested "income ⊇ caps ⊇ spent" bar. Tells the structural
// plan-vs-plan story AND budget consumption in one picture, and is the home for
// the spend/caps numbers that used to clutter the Position card.
export function SpendingVsPlanCard({
  position, categorised, inboxCount,
}: {
  position: Position;
  categorised: number;
  inboxCount: number;
}) {
  const g = spendingVsPlanGeometry(position);
  const m0 = (n: number) => formatCurrency(n, { decimals: 0, signDisplay: "never" });

  return (
    <div className="mb-3 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Spending vs plan
        </span>
        <div className="flex items-center gap-2">
          {/* The one non-redundant readout — caps consumption — as a compact pill;
              every dollar figure already lives in the bar legend below. */}
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              g.capsUsedPct >= 100 ? "bg-negative/15 text-negative" : "bg-sunken text-ink-muted"
            }`}
          >
            {g.capsUsedPct}% of caps
          </span>
          <ExplainerTrigger explainer={explainSpendingVsPlan(position)} />
        </div>
      </div>

      {/* nested bar */}
      <div className="mt-4">
        <div className="relative h-[30px] overflow-hidden rounded-[7px] bg-sunken">
          <div className="absolute left-0 top-0 h-full rounded-l-[7px] bg-outflow" style={{ width: `${g.spent.widthPct}%` }} />
          {g.capsUnspent.widthPct > 0 && (
            <div className="absolute top-0 h-full bg-ink-muted/30" style={{ left: `${g.spent.widthPct}%`, width: `${g.capsUnspent.widthPct}%` }} />
          )}
          {g.headroom.widthPct > 0 && (
            <div className="absolute top-0 h-full bg-positive/30" style={{ left: `${g.spent.widthPct + g.capsUnspent.widthPct}%`, width: `${g.headroom.widthPct}%` }} />
          )}
          {/* caps boundary tick */}
          <div className="absolute -top-0.5 bottom-[-2px] w-0.5 bg-ink-strong/55" style={{ left: `${g.capsTickPct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-[9.5px] text-ink-faint">
          <span>$0</span>
          <span>{g.hasPlan ? `planned income ${m0(g.planned)}` : `caps ${m0(g.budget)}`}</span>
        </div>
      </div>

      {/* legend */}
      <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[10.5px] text-ink-muted">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-outflow" />spent {m0(g.spent.value)}</span>
        {g.capsUnspent.value > 0 && <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-ink-muted/30" />caps unspent {m0(g.capsUnspent.value)}</span>}
        {g.headroom.value > 0 && <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-positive/30" />headroom {m0(g.headroom.value)}</span>}
        {g.overCap > 0 && <span className="flex items-center gap-1.5 text-negative">over caps {m0(g.overCap)}</span>}
      </div>

      <div className="mt-3 border-t border-hairline pt-2.5 text-[11px] text-ink-faint">
        {/* Structure: the legend's green "headroom" already says caps fit when there's
            room; only the over-committed case needs an explicit warning. */}
        {g.hasPlan && g.structurePerMo < 0 && (
          <span className="text-negative">⚠ caps {m0(-g.structurePerMo)}/mo over income · </span>
        )}
        based on {categorised} categorised
        {inboxCount > 0 && (
          <> · <Link href="/inbox" className="text-accent underline-offset-2 hover:underline">{inboxCount} in inbox</Link></>
        )}
      </div>
    </div>
  );
}
