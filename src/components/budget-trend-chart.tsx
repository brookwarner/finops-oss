"use client";

import { scaleBand } from "@visx/scale";
import type { HistoryPoint } from "@/lib/budgets/snapshot";
import {
  trendBarGeometry,
  type TrendBar,
  type TrendGeometry,
} from "@/lib/budgets/trend-geometry";
import { formatCurrency } from "@/lib/format";
import {
  ResponsiveChart,
  ReferenceLine,
  ChartTooltip,
  useChartTooltip,
  chartColor,
  ragRole,
  incomeRole,
  type ChartDims,
} from "@/components/charts";

// Inline bar chart for a category's recent cycles. Bars coloured by RAG
// (income RAG inverted), with dashed target + dotted average reference lines on
// the same axis, and a tap/hover tooltip per cycle. Geometry is the pure
// trendBarGeometry; colour is applied here. Renders nothing without history.
const STATUS_LABEL: Record<string, string> = { over: "over", warning: "near", ok: "on track" };

function barRole(b: TrendBar) {
  return b.kind === "income" ? incomeRole(b.pctOfTarget) : ragRole(b.status);
}

export function BudgetTrendChart({ series }: { series: HistoryPoint[] }) {
  const geo = trendBarGeometry(series);
  if (!geo) return null;
  return (
    <div className="mt-3 rounded-control border border-hairline bg-sunken p-2.5">
      <div className="mb-2 text-[12px] text-ink-muted">
        {series.length} cycle{series.length === 1 ? "" : "s"}
      </div>
      <ResponsiveChart className="h-20 w-full">
        {(dims) => <TrendBars geo={geo} dims={dims} />}
      </ResponsiveChart>
      <div className="mt-1 flex gap-1.5">
        {geo.bars.map((b, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-ink-faint">
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendBars({ geo, dims }: { geo: TrendGeometry; dims: ChartDims }) {
  const { innerWidth, innerHeight } = dims;
  const band = scaleBand<number>({
    domain: geo.bars.map((_, i) => i),
    range: [0, innerWidth],
    padding: 0.28,
  });
  const bw = band.bandwidth();
  const yFor = (pct: number) => innerHeight - (pct / 100) * innerHeight;
  const center = (i: number) => (band(i) ?? 0) + bw / 2;

  const tip = useChartTooltip<TrendBar>({
    data: geo.bars,
    getX: (_b, i) => center(i),
    getY: (b) => yFor(b.heightPct),
  });

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        {geo.bars.map((b, i) => {
          const h = Math.max(2, (b.heightPct / 100) * innerHeight);
          return (
            <rect
              key={i}
              x={band(i) ?? 0}
              y={innerHeight - h}
              width={bw}
              height={h}
              rx={1.5}
              fill={chartColor(barRole(b))}
            />
          );
        })}
        {/* target line (amber dashed) */}
        <ReferenceLine
          y={yFor(geo.targetPct)}
          x1={0}
          x2={innerWidth}
          role="warning"
          label={formatCurrency(geo.target, { decimals: 0, signDisplay: "never" })}
          labelSide="right"
        />
        {/* average line (muted dotted) */}
        <ReferenceLine
          y={yFor(geo.avgPct)}
          x1={0}
          x2={innerWidth}
          role="faint"
          dash="1 2"
          label={`avg ${formatCurrency(geo.avg, { decimals: 0, signDisplay: "never" })}`}
          labelSide="left"
        />
      </svg>
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip
          left={tip.tooltipLeft ?? 0}
          top={tip.tooltipTop ?? 0}
          width={dims.width}
        >
          <span style={{ fontWeight: 600 }}>
            {formatCurrency(tip.tooltipData.value, { decimals: 0, signDisplay: "never" })}
          </span>{" "}
          <span style={{ color: chartColor("muted") }}>
            {tip.tooltipData.label}
            {tip.tooltipData.kind !== "income" &&
              ` · ${STATUS_LABEL[tip.tooltipData.status] ?? ""}`}
          </span>
        </ChartTooltip>
      )}
    </>
  );
}
