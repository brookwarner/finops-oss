"use client";

import { scaleLinear } from "@visx/scale";
import { LinePath, AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import type { TrendPoint } from "@/lib/networth/trend";
import { netWorthDomain } from "@/lib/networth/chart-domain";
import { formatCurrency, formatDateShort } from "@/lib/format";
import {
  ResponsiveChart,
  AreaGradient,
  ChartTooltip,
  Crosshair,
  useChartTooltip,
  chartColor,
  type ChartDims,
} from "@/components/charts";

// Net-worth trend sparkline. A gradient-filled area + line, scaled with the
// min-band domain (so trivial moves don't read as a cliff) and coloured by the
// window's direction (up = positive, down = negative). Tap/hover surfaces the
// snapshot under the finger. Built on the shared chart foundation.
const MARGIN = { top: 4, right: 1, bottom: 2, left: 1 };

export function NetWorthChart({
  points,
  className,
}: {
  points: TrendPoint[];
  className?: string;
}) {
  // A single point can't draw a line, and zero points has nothing to show.
  if (points.length < 2) return null;

  return (
    <ResponsiveChart className={className ?? "h-12 w-full"} margin={MARGIN}>
      {(dims) => <NetWorthInner points={points} dims={dims} />}
    </ResponsiveChart>
  );
}

function NetWorthInner({ points, dims }: { points: TrendPoint[]; dims: ChartDims }) {
  const { innerWidth, innerHeight, margin } = dims;
  const [lo, hi] = netWorthDomain(points.map((p) => p.net));

  const xScale = scaleLinear<number>({
    domain: [0, points.length - 1],
    range: [margin.left, margin.left + innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: [lo, hi],
    range: [margin.top + innerHeight, margin.top],
  });

  const rising = points[points.length - 1].net >= points[0].net;
  const role = rising ? "positive" : "negative";
  const stroke = chartColor(role);
  const gradId = rising ? "nw-grad-up" : "nw-grad-down";

  const cx = (_p: TrendPoint, i: number) => xScale(i);
  const cy = (p: TrendPoint) => yScale(p.net);

  const tip = useChartTooltip<TrendPoint>({ data: points, getX: cx, getY: cy });

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        <AreaGradient id={gradId} role={role} from={0.22} to={0} />
        <AreaClosed<TrendPoint>
          data={points}
          x={cx}
          y={cy}
          yScale={yScale}
          curve={curveMonotoneX}
          fill={`url(#${gradId})`}
          stroke="none"
        />
        <LinePath<TrendPoint>
          data={points}
          x={cx}
          y={cy}
          curve={curveMonotoneX}
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {tip.tooltipOpen && tip.tooltipLeft != null && (
          <Crosshair
            x={tip.tooltipLeft}
            top={margin.top}
            bottom={margin.top + innerHeight}
            cy={tip.tooltipTop}
            color={stroke}
          />
        )}
      </svg>
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip left={tip.tooltipLeft ?? 0} top={tip.tooltipTop ?? 0} width={dims.width}>
          <span style={{ fontWeight: 600 }}>
            {formatCurrency(tip.tooltipData.net, { decimals: 0 })}
          </span>{" "}
          <span style={{ color: chartColor("muted") }}>
            {formatDateShort(`${tip.tooltipData.date}T00:00:00`)}
          </span>
        </ChartTooltip>
      )}
    </>
  );
}
