"use client";

import { scaleBand } from "@visx/scale";
import { formatCurrency } from "@/lib/format";
import { dailyBurnGeometry, type BurnBar } from "@/lib/spend/daily-burn-geometry";
import type { DailyBurnResult } from "@/lib/spend/daily-burn";
import {
  ResponsiveChart,
  ReferenceLine,
  ChartTooltip,
  useChartTooltip,
  chartColor,
  type ChartDims,
} from "@/components/charts";

// Daily burn sparkbars: one bar per elapsed day of the cycle, days over the
// planned daily figure coloured hot (red), the rest muted. A dashed plan line and
// a solid trailing-average line share the bars' axis so "am I burning hotter than
// plan, and is the pace rising?" reads at a glance. Geometry is pure
// (daily-burn-geometry); colour + pixels live here, on the shared visx foundation
// (same pattern as income-pace-card.tsx).
export function DailyBurnChart({ result }: { result: DailyBurnResult }) {
  const geo = dailyBurnGeometry(result);
  if (!geo.bars.length) return null;
  return (
    <ResponsiveChart className="h-24 w-full">
      {(dims) => <BurnBars geo={geo} planned={result.plannedPerDay} dims={dims} />}
    </ResponsiveChart>
  );
}

function BurnBars({
  geo,
  planned,
  dims,
}: {
  geo: ReturnType<typeof dailyBurnGeometry>;
  planned: number;
  dims: ChartDims;
}) {
  const { innerWidth, innerHeight } = dims;
  const band = scaleBand<number>({
    domain: geo.bars.map((_, i) => i),
    range: [0, innerWidth],
    padding: 0.2,
  });
  const bw = band.bandwidth();
  const yFor = (pct: number) => innerHeight - (pct / 100) * innerHeight;
  const center = (i: number) => (band(i) ?? 0) + bw / 2;

  const tip = useChartTooltip<BurnBar>({
    data: geo.bars,
    getX: (_b, i) => center(i),
    getY: (b) => yFor(b.heightPct),
  });

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        {/* per-day bars: hot (red) when over plan, muted otherwise */}
        {geo.bars.map((b, i) => {
          const h = Math.max(b.spend > 0 ? 1.5 : 0, (b.heightPct / 100) * innerHeight);
          return (
            <rect
              key={i}
              x={band(i) ?? 0}
              y={innerHeight - h}
              width={bw}
              height={h}
              rx={1.5}
              fill={chartColor(b.overPlan ? "negative" : "muted")}
              opacity={b.overPlan ? 0.95 : 0.55}
            />
          );
        })}
        {/* plan line (amber dashed) */}
        <ReferenceLine
          y={yFor(geo.planPct)}
          x1={0}
          x2={innerWidth}
          role="warning"
          dash="4 3"
          label={`plan ${formatCurrency(planned, { decimals: 0, signDisplay: "never" })}`}
          labelSide="right"
        />
        {/* trailing-average line (solid ink) — the headline pace */}
        <line
          x1={0}
          x2={innerWidth}
          y1={yFor(geo.trailingPct)}
          y2={yFor(geo.trailingPct)}
          stroke={chartColor("ink")}
          strokeWidth={1.5}
        />
      </svg>
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip left={tip.tooltipLeft ?? 0} top={tip.tooltipTop ?? 0} width={dims.width}>
          <span style={{ fontWeight: 600 }}>
            {formatCurrency(tip.tooltipData.spend, { decimals: 0, signDisplay: "never" })}
          </span>{" "}
          <span style={{ color: chartColor("muted") }}>{tip.tooltipData.date.slice(5)}</span>
        </ChartTooltip>
      )}
    </>
  );
}
