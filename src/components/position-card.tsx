import { formatCurrency } from "@/lib/format";
import type { Position } from "@/lib/budgets/position";
import { positionFlowGeometry } from "@/lib/budgets/position-flow-geometry";
import { ExplainerTrigger } from "@/components/explainer-trigger";
import { explainPosition } from "@/lib/explainers/budget-hero";

// Position card: the glanceable "am I on track this cycle". Hero = projected net;
// the two In/Out bars (solid = so far, hatched = projected) on a shared scale make
// the projection legible — the overhang between the projected ends IS the hero.
export function PositionCard({ position }: { position: Position }) {
  const g = positionFlowGeometry(position);
  const m0 = (n: number) => formatCurrency(n, { decimals: 0, signDisplay: "never" });
  const signed = (n: number) => formatCurrency(n, { decimals: 0, signDisplay: "always" });
  const net = position.net;

  return (
    <div className="mb-3 rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Position · this cycle
        </span>
        <ExplainerTrigger explainer={explainPosition(position)} />
      </div>

      <div className="mt-1.5 flex items-baseline gap-2">
        <span className={`text-[44px] font-bold leading-none tabular-nums tracking-tight ${net.projected >= 0 ? "text-positive" : "text-negative"}`}>
          {signed(net.projected)}
        </span>
        <span className="text-[13px] text-ink-muted">projected by cycle end</span>
      </div>

      <div className="mt-1 text-[12px] text-ink-faint">
        <span className={`text-[15px] font-semibold tabular-nums ${net.actual >= 0 ? "text-positive" : "text-negative"}`}>
          {signed(net.actual)}
        </span>{" "}
        so far
        {position.expenses.pending > 0 && <> · +{m0(position.expenses.pending)} pending</>}
      </div>

      {/* In/Out projection bars on a shared scale */}
      <div className="mt-4 flex flex-col gap-3">
        <FlowRow
          label="In" dotClass="bg-positive-bar" solidClass="bg-positive-bar"
          bar={g.in} m0={m0} projColor="text-positive"
        />
        <FlowRow
          label="Out" dotClass="bg-outflow" solidClass="bg-outflow"
          bar={g.out} m0={m0} projColor="text-outflow"
        />
        {/* overhang bracket = the projected net, shown spatially */}
        <div className="relative h-6">
          <div
            className={`absolute top-0 h-3 ${g.overhang.surplus ? "border-positive" : "border-negative"} border-l-2 border-r-2 border-dashed`}
            style={{ left: `${g.overhang.startPct}%`, width: `${g.overhang.widthPct}%` }}
          />
          {/* Right-anchored so the label never runs off the card edge, whatever
              the overhang's horizontal position. */}
          <div
            className={`absolute right-0 top-3.5 whitespace-nowrap text-[10.5px] font-semibold tabular-nums ${g.overhang.surplus ? "text-positive" : "text-negative"}`}
          >
            {signed(g.projectedNet)} projected {g.overhang.surplus ? "surplus" : "shortfall"}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-hairline pt-2.5 text-[11px] leading-relaxed text-ink-faint">
        <span className="text-ink-muted">Projected</span> — by cycle end you&apos;re on track to take in{" "}
        <span className="tabular-nums text-ink">{m0(position.income.expected)}</span> and spend{" "}
        <span className="tabular-nums text-ink">{m0(position.expenses.projected)}</span> — leaving{" "}
        <span className={`tabular-nums font-semibold ${net.projected >= 0 ? "text-positive" : "text-negative"}`}>{signed(net.projected)}</span>.
      </div>
    </div>
  );
}

function FlowRow({
  label, dotClass, solidClass, bar, m0, projColor,
}: {
  label: string; dotClass: string; solidClass: string;
  bar: { solidPct: number; ghostPct: number; actual: number; projected: number };
  m0: (n: number) => string; projColor: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[12px]">
        <span className="flex items-center gap-2 font-semibold text-ink-muted">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-ink-faint">
          →{" "}<span className={`font-semibold ${projColor}`}>{m0(bar.projected)}</span> projected
        </span>
      </div>
      <div className="relative h-[18px] overflow-hidden rounded bg-sunken">
        <div className={`absolute left-0 top-0 h-full rounded-l ${solidClass}`} style={{ width: `${bar.solidPct}%` }} />
        {bar.ghostPct > 0 && (
          <div
            className={`absolute top-0 h-full opacity-[0.34] ${solidClass} [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,rgb(255_255_255/0.18)_3px,rgb(255_255_255/0.18)_6px)]`}
            style={{ left: `${bar.solidPct}%`, width: `${bar.ghostPct}%` }}
          />
        )}
      </div>
      {/* "so far" value right-aligned to the end of the SOLID segment, so the
          number visibly labels the solid bar it represents. */}
      <div className="relative mt-0.5 h-3.5">
        <div
          className="absolute left-0 text-right text-[10.5px] tabular-nums whitespace-nowrap"
          style={{ width: `${bar.solidPct}%` }}
        >
          <span className="font-bold text-ink">{m0(bar.actual)}</span>{" "}
          <span className="text-ink-faint">so far</span>
        </div>
      </div>
    </div>
  );
}
