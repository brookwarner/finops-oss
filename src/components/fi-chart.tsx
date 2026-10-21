"use client";

import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import { formatCurrency } from "@/lib/format";
import {
  ResponsiveChart,
  ReferenceLine,
  ChartTooltip,
  Crosshair,
  useChartTooltip,
  chartColor,
  type ChartDims,
} from "@/components/charts";

// FI trajectory: projected assets climbing toward a flat target line, with the
// crossover marked. Tap/hover reads off the projected balance for any month.
// Pure renderer — the page supplies the monthly points and the target.
const MARGIN = { top: 8, right: 6, bottom: 16, left: 40 };

interface FIPoint {
  month: number;
  value: number;
}

export function FIChart({
  points,
  target,
  reachedMonth,
  fiYear,
  className,
}: {
  points: number[]; // projected assets, one per month (index 0 = now)
  target: number;
  reachedMonth: number | null;
  fiYear: number | null;
  className?: string;
}) {
  if (points.length < 2 || target <= 0) return null;
  const data: FIPoint[] = points.map((value, month) => ({ month, value }));

  return (
    <ResponsiveChart className={className} margin={MARGIN}>
      {(dims) => (
        <FIInner
          data={data}
          target={target}
          reachedMonth={reachedMonth}
          fiYear={fiYear}
          dims={dims}
        />
      )}
    </ResponsiveChart>
  );
}

function FIInner({
  data,
  target,
  reachedMonth,
  fiYear,
  dims,
}: {
  data: FIPoint[];
  target: number;
  reachedMonth: number | null;
  fiYear: number | null;
  dims: ChartDims;
}) {
  const { innerWidth, innerHeight, margin } = dims;
  const max = data.reduce((m, p) => (p.value > m ? p.value : m), target) * 1.05;

  const xScale = scaleLinear<number>({
    domain: [0, data.length - 1],
    range: [margin.left, margin.left + innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: [0, max],
    range: [margin.top + innerHeight, margin.top],
  });

  const stroke = chartColor("positive");
  const cx = (p: FIPoint) => xScale(p.month);
  const cy = (p: FIPoint) => yScale(p.value);
  const tip = useChartTooltip<FIPoint>({ data, getX: cx, getY: cy });

  const reached =
    reachedMonth != null && reachedMonth < data.length ? data[reachedMonth] : null;

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        <ReferenceLine
          y={yScale(target)}
          x1={margin.left}
          x2={margin.left + innerWidth}
        />
        <LinePath<FIPoint>
          data={data}
          x={cx}
          y={cy}
          curve={curveMonotoneX}
          stroke={stroke}
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {reached && (
          <circle cx={cx(reached)} cy={cy(reached)} r={3} fill={stroke} />
        )}
        {/* Y axis: base + target */}
        <text x={margin.left - 6} y={margin.top + innerHeight} textAnchor="end" dominantBaseline="middle" fontSize={9} fill={chartColor("muted")}>
          {formatCurrency(0, { decimals: 0 })}
        </text>
        <text x={margin.left - 6} y={yScale(target)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill={chartColor("muted")}>
          {formatCurrency(target, { decimals: 0 })}
        </text>
        {/* Target line label */}
        <text x={margin.left + innerWidth} y={yScale(target) - 4} textAnchor="end" fontSize={9} fill={chartColor("muted")}>
          FI target
        </text>
        {/* X axis: now + FI year */}
        <text x={margin.left} y={margin.top + innerHeight + 12} textAnchor="start" fontSize={9} fill={chartColor("muted")}>
          now
        </text>
        {fiYear != null && (
          <text x={margin.left + innerWidth} y={margin.top + innerHeight + 12} textAnchor="end" fontSize={9} fill={chartColor("muted")}>
            {fiYear}
          </text>
        )}
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
        <ChartTooltip
          left={tip.tooltipLeft ?? 0}
          top={tip.tooltipTop ?? 0}
          width={dims.width}
        >
          <span style={{ fontWeight: 600 }}>
            {formatCurrency(tip.tooltipData.value, { decimals: 0 })}
          </span>{" "}
          <span style={{ color: chartColor("muted") }}>
            {tip.tooltipData.month === 0
              ? "now"
              : `+${tip.tooltipData.month} mo`}
          </span>
        </ChartTooltip>
      )}
    </>
  );
}
