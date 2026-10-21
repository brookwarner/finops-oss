"use client";

import { scaleBand } from "@visx/scale";
import type { IncomeHistory } from "@/lib/income/history";
import {
  incomeTrendGeometry,
  type IncomeTrendBar,
  type IncomeTrendGeometry,
} from "@/lib/income/trend-geometry";
import { formatCurrency } from "@/lib/format";
import {
  ResponsiveChart,
  ReferenceLine,
  ChartTooltip,
  useChartTooltip,
  chartColor,
  type ChartDims,
} from "@/components/charts";

export function IncomeTrendChart({ history }: { history: IncomeHistory }) {
  const geo = incomeTrendGeometry(history.cycles);
  if (!geo) return null;
  return (
    <section className="rounded-card bg-surface p-4 shadow-card">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink">Income trend</h2>
        <span className="text-[11px] text-ink-faint">
          {geo.bars.length} cycle{geo.bars.length === 1 ? "" : "s"} · plan{" "}
          {formatCurrency(geo.bars[0]?.plannedTotal ?? 0)}
        </span>
      </div>
      <ResponsiveChart className="h-32 w-full">
        {(dims) => <IncomeBars geo={geo} dims={dims} />}
      </ResponsiveChart>
      <div className="mt-1 flex gap-1.5">
        {geo.bars.map((b, i) => (
          <div key={i} className="flex-1 text-center text-[9px] text-ink-faint">
            {b.label}
          </div>
        ))}
      </div>
    </section>
  );
}

function IncomeBars({ geo, dims }: { geo: IncomeTrendGeometry; dims: ChartDims }) {
  const { innerWidth, innerHeight } = dims;
  const band = scaleBand<number>({
    domain: geo.bars.map((_, i) => i),
    range: [0, innerWidth],
    padding: 0.28,
  });
  const bw = band.bandwidth();
  const yForFrac = (frac: number) => innerHeight - frac * innerHeight;
  const center = (i: number) => (band(i) ?? 0) + bw / 2;

  const tip = useChartTooltip<IncomeTrendBar>({
    data: geo.bars,
    getX: (_b, i) => center(i),
    getY: (b) => yForFrac(b.totalFrac),
  });

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        <g>
          {geo.bars.map((b, i) =>
            b.segments.map((s, j) => {
              const yTop = yForFrac(s.fracEnd);
              const h = Math.max(0, (s.fracEnd - s.fracStart) * innerHeight);
              return (
                <rect
                  key={`${i}-${j}`}
                  x={band(i) ?? 0}
                  y={yTop}
                  width={bw}
                  height={h}
                  rx={1.5}
                  fill={chartColor("positive", s.alpha)}
                />
              );
            }),
          )}
          <ReferenceLine
            y={yForFrac(geo.planFrac)}
            x1={0}
            x2={innerWidth}
            role="faint"
            dash="3 3"
          />
        </g>
      </svg>
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip
          left={tip.tooltipLeft ?? 0}
          top={tip.tooltipTop ?? 0}
          width={dims.width}
        >
          <div style={{ fontWeight: 600 }}>{tip.tooltipData.label}</div>
          <div style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(tip.tooltipData.total)} /{" "}
            {formatCurrency(tip.tooltipData.plannedTotal)} plan
          </div>
          <div style={{ marginTop: 4 }}>
            {tip.tooltipData.segments.map((s) => (
              <div
                key={s.categoryId}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  fontSize: 11,
                  color: chartColor("muted"),
                }}
              >
                <span>{s.name}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatCurrency(s.actual)} / {formatCurrency(s.plan)}
                </span>
              </div>
            ))}
          </div>
        </ChartTooltip>
      )}
    </>
  );
}
