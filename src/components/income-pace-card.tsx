"use client";

import { scaleBand } from "@visx/scale";
import { formatCurrency } from "@/lib/format";
import {
  incomePaceGeometry,
  type IncomePoint,
  type IncomeBar,
} from "@/lib/budgets/income-pace-geometry";
import {
  ResponsiveChart,
  ReferenceLine,
  ChartTooltip,
  useChartTooltip,
  chartColor,
  type ChartDims,
} from "@/components/charts";

// Card 3 (hybrid): income per cycle (bars) against the plan (dashed amber line)
// with a pace marker over the current cycle — where the plan says income should be
// by today. Geometry is pure (income-pace-geometry); colour + pixels live here, on
// the shared visx chart foundation (same pattern as budget-trend-chart.tsx).
export function IncomePaceChart({
  series,
  planned,
  expectedByNow,
}: {
  series: IncomePoint[];
  planned: number;
  expectedByNow: number;
}) {
  const geo = incomePaceGeometry(series, planned, expectedByNow);
  return (
    <div>
      <ResponsiveChart className="h-28 w-full">
        {(dims) => <PaceBars geo={geo} dims={dims} />}
      </ResponsiveChart>
      <div className="mt-1 flex gap-1.5">
        {geo.bars.map((b, i) => (
          <div
            key={i}
            className={`flex-1 text-center text-[9px] ${b.isCurrent ? "text-accent" : "text-ink-faint"}`}
          >
            {b.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function PaceBars({
  geo,
  dims,
}: {
  geo: ReturnType<typeof incomePaceGeometry>;
  dims: ChartDims;
}) {
  const { innerWidth, innerHeight } = dims;
  const band = scaleBand<number>({
    domain: geo.bars.map((_, i) => i),
    range: [0, innerWidth],
    padding: 0.28,
  });
  const bw = band.bandwidth();
  const yFor = (pct: number) => innerHeight - (pct / 100) * innerHeight;
  const center = (i: number) => (band(i) ?? 0) + bw / 2;

  const tip = useChartTooltip<IncomeBar>({
    data: geo.bars,
    getX: (_b, i) => center(i),
    getY: (b) => yFor(b.heightPct),
  });

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        {/* bars: current cycle brighter, prior cycles dimmed */}
        {geo.bars.map((b, i) => {
          const h = Math.max(2, (b.heightPct / 100) * innerHeight);
          return (
            <rect
              key={i}
              x={band(i) ?? 0}
              y={innerHeight - h}
              width={bw}
              height={h}
              rx={3}
              fill={chartColor("positive")}
              opacity={b.isCurrent ? 0.95 : 0.5}
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
          label={`plan ${formatCurrency(geo.planned, { decimals: 0, signDisplay: "never" })}`}
          labelSide="right"
        />
        {/* pace marker over the current bar: where the plan says income should be by now */}
        {geo.paceMarker && (
          <line
            x1={(band(geo.paceMarker.barIndex) ?? 0) - 2}
            x2={(band(geo.paceMarker.barIndex) ?? 0) + bw + 2}
            y1={yFor(geo.paceMarker.heightPct)}
            y2={yFor(geo.paceMarker.heightPct)}
            stroke={chartColor("ink")}
            strokeWidth={2}
          />
        )}
      </svg>
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip left={tip.tooltipLeft ?? 0} top={tip.tooltipTop ?? 0} width={dims.width}>
          <span style={{ fontWeight: 600 }}>
            {formatCurrency(tip.tooltipData.total, { decimals: 0, signDisplay: "never" })}
          </span>{" "}
          <span style={{ color: chartColor("muted") }}>{tip.tooltipData.label}</span>
        </ChartTooltip>
      )}
    </>
  );
}
