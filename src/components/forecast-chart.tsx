"use client";

import { scaleLinear } from "@visx/scale";
import { LinePath, AreaClosed } from "@visx/shape";
import { curveMonotoneX } from "@visx/curve";
import type { ForecastResult } from "@/lib/forecast/compute";
import { paydayIndexes } from "@/lib/forecast/chart-markers";
import { formatCurrency, formatDateShort } from "@/lib/format";
import {
  ResponsiveChart,
  AreaGradient,
  ReferenceLine,
  ChartTooltip,
  Crosshair,
  useChartTooltip,
  chartColor,
  type ChartDims,
} from "@/components/charts";

// Cash-runway chart. A monotone-smoothed balance line (curveMonotoneX — never
// overshoots a real data point, so the line can't dip below the true trough)
// over a soft gradient fill, with a danger band below $0, the dashed zero
// baseline, pay/trough markers, and a tap/hover tooltip for any day. Line/fill
// go red when the trough dips below $0, positive otherwise. Paydays are derived
// from the series (up-jumps vs the prior day) so no extra data is needed.
const MARGIN = { top: 16, right: 6, bottom: 12, left: 4 };
const money = (v: number) => formatCurrency(v, { decimals: 0 });
const shortDate = (iso: string) => formatDateShort(`${iso}T00:00:00`);

type Day = { date: string; balance: number };

export function ForecastChart({
  result,
  className,
}: {
  result: ForecastResult;
  className?: string;
}) {
  if (result.series.length < 2) return null;
  return (
    <ResponsiveChart className={className} margin={MARGIN}>
      {(dims) => <ForecastInner result={result} dims={dims} />}
    </ResponsiveChart>
  );
}

function ForecastInner({ result, dims }: { result: ForecastResult; dims: ChartDims }) {
  const { innerWidth, innerHeight, margin } = dims;
  const pts: Day[] = result.series;

  const vals = pts.map((p) => p.balance);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;

  const xScale = scaleLinear<number>({
    domain: [0, pts.length - 1],
    range: [margin.left, margin.left + innerWidth],
  });
  const yScale = scaleLinear<number>({
    domain: [min, min + span],
    range: [margin.top + innerHeight, margin.top],
  });

  const ok = result.verdict.makesIt;
  const role = ok ? "positive" : "negative";
  const stroke = chartColor(role);
  const gradId = `forecast-area-${ok ? "ok" : "short"}`;

  const cx = (_p: Day, i: number) => xScale(i);
  const cy = (p: Day) => yScale(p.balance);
  const zeroY = yScale(0);
  const bottomY = margin.top + innerHeight;

  const troughIdx = pts.findIndex((p) => p.date === result.trough.date);
  const paydayIdxs = paydayIndexes(vals);
  const nextPaydayIdx = result.nextPayday
    ? pts.findIndex((p) => p.date === result.nextPayday!.date)
    : -1;
  const billsDueIdx = result.billsDue
    ? pts.findIndex((p) => p.date === result.billsDue!.date)
    : -1;

  const tip = useChartTooltip<Day>({ data: pts, getX: cx, getY: cy });

  return (
    <>
      <svg width={dims.width} height={dims.height} {...tip.handlers}>
        <AreaGradient id={gradId} role={role} from={0.22} to={0} />
        {/* Danger zone: everything below $0 */}
        {zeroY < bottomY && (
          <rect
            x={margin.left}
            y={zeroY}
            width={innerWidth}
            height={bottomY - zeroY}
            fill={chartColor("negative", 0.08)}
          />
        )}
        {/* Zero baseline */}
        <ReferenceLine
          y={zeroY}
          x1={margin.left}
          x2={margin.left + innerWidth}
          dash="1.5 1.5"
        />
        {/* Smoothed cash-level area + line */}
        <AreaClosed<Day>
          data={pts}
          x={cx}
          y={cy}
          yScale={yScale}
          curve={curveMonotoneX}
          fill={`url(#${gradId})`}
          stroke="none"
        />
        <LinePath<Day>
          data={pts}
          x={cx}
          y={cy}
          curve={curveMonotoneX}
          stroke={stroke}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Pay ticks — quiet by default; the next payday reads loudest */}
        {paydayIdxs.map((i) => {
          const isNext = i === nextPaydayIdx;
          return (
            <circle
              key={i}
              cx={xScale(i)}
              cy={yScale(pts[i].balance)}
              r={isNext ? 4 : 2.5}
              fill={chartColor("positive")}
              opacity={isNext ? 1 : 0.5}
            />
          );
        })}
        {/* Trough dot — ringed so it stands clear of the fill */}
        {troughIdx >= 0 && (
          <circle
            cx={xScale(troughIdx)}
            cy={yScale(result.trough.balance)}
            r={5}
            fill={stroke}
            stroke={chartColor("surface")}
            strokeWidth={2}
          />
        )}

        {/* "pay" marker on the next payday */}
        {nextPaydayIdx >= 0 && (
          <text
            x={xScale(nextPaydayIdx)}
            y={yScale(pts[nextPaydayIdx].balance) - 9}
            textAnchor="middle"
            fontSize={10}
            fill={chartColor("positive")}
          >
            pay
          </text>
        )}
        {/* "bills" guide — the cluster the verdict is judged against */}
        {billsDueIdx >= 0 && (
          <>
            <line
              x1={xScale(billsDueIdx)}
              x2={xScale(billsDueIdx)}
              y1={margin.top}
              y2={bottomY}
              stroke={chartColor("muted")}
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.45}
            />
            <text
              x={xScale(billsDueIdx)}
              y={margin.top + 8}
              textAnchor="middle"
              fontSize={10}
              fill={chartColor("muted")}
            >
              bills
            </text>
          </>
        )}

        {/* Crosshair while interacting */}
        {tip.tooltipOpen && tip.tooltipLeft != null && (
          <Crosshair
            x={tip.tooltipLeft}
            top={margin.top}
            bottom={bottomY}
            cy={tip.tooltipTop}
            color={stroke}
          />
        )}
      </svg>

      {/* $0 marker on the zero line (left edge) */}
      <span
        className="pointer-events-none absolute -translate-y-1/2 bg-surface pr-1 text-[10px] leading-none text-ink-faint tabular-nums"
        style={{ left: margin.left, top: zeroY }}
      >
        $0
      </span>

      {/* Trough callout (date + balance) */}
      {troughIdx >= 0 && (
        <ForecastTroughLabel
          ok={ok}
          x={xScale(troughIdx)}
          y={yScale(result.trough.balance)}
          width={dims.width}
          // Drop below the dot when it sits high on the chart (top ~28%) or when
          // the balance is underwater (below it is the danger band, clear of the
          // $0/pay labels that cluster on the zero line).
          below={yScale(result.trough.balance) < margin.top + innerHeight * 0.28 || result.trough.balance < 0}
          text={`${money(result.trough.balance)} · ${shortDate(result.trough.date)}`}
        />
      )}

      {/* Horizon end date, bottom-right (left edge is implicitly "today") */}
      <span
        className="pointer-events-none absolute bottom-0 right-0 text-[10px] leading-none text-ink-faint"
      >
        {shortDate(pts[pts.length - 1].date)}
      </span>

      {/* Interactive per-day tooltip */}
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip
          left={tip.tooltipLeft ?? 0}
          top={tip.tooltipTop ?? 0}
          width={dims.width}
        >
          <span style={{ fontWeight: 600 }}>{money(tip.tooltipData.balance)}</span>{" "}
          <span style={{ color: chartColor("muted") }}>
            {shortDate(tip.tooltipData.date)}
          </span>
        </ChartTooltip>
      )}
    </>
  );
}

// Trough callout, anchored to stay inside the chart: flips to the right edge when
// the dot is far right, and drops below the dot when it sits high or underwater
// (where the danger band keeps it clear of the $0/pay labels on the zero line).
function ForecastTroughLabel({
  ok,
  x,
  y,
  width,
  below,
  text,
}: {
  ok: boolean;
  x: number;
  y: number;
  width: number;
  below: boolean;
  text: string;
}) {
  // Anchor to the right edge when the dot is far right, so the callout stays in.
  const anchorRight = x > width * 0.62;
  return (
    <span
      className={`pointer-events-none absolute whitespace-nowrap rounded bg-surface px-1 text-[10px] font-semibold leading-tight tabular-nums ${ok ? "text-positive" : "text-negative"}`}
      style={{
        left: x,
        top: y,
        transform: `translate(${anchorRight ? "-100%" : "0"}, ${below ? "0.4rem" : "-1.3rem"})`,
      }}
    >
      {text}
    </span>
  );
}
