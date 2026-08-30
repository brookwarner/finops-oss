// src/components/cashflow-chart.tsx
"use client";

import { scaleLinear } from "@visx/scale";
import { LinePath } from "@visx/shape";
import { curveLinear } from "@visx/curve";
import { formatCurrency, formatDateShort } from "@/lib/format";
import {
  ResponsiveChart, ReferenceLine, ChartTooltip, Crosshair, useChartTooltip,
  chartColor, type ChartDims, type ChartRole,
} from "@/components/charts";

export interface CashflowChartLine {
  key: string;
  label: string;
  series: { date: string; balance: number }[];
  creditZeroDate: string | null;
}

// Each scenario line's stroke role + style. Actual is the solid hero; the others
// are dashed references; custom is a distinct warning tint shown only when present.
const LINE_STYLE: Record<string, { role: ChartRole; dash?: string; width: number }> = {
  actual:         { role: "positive", width: 1.8 },
  onBudget:       { role: "violet",   dash: "4 3", width: 1.4 },
  bareEssentials: { role: "reserve",  dash: "2 3", width: 1.4 },
  custom:         { role: "warning",  dash: "5 2", width: 1.5 },
};

export function CashflowChart({ lines, creditHeadroom }: { lines: CashflowChartLine[]; creditHeadroom: number }) {
  return (
    <ResponsiveChart className="h-56 w-full" margin={{ top: 10, right: 10, bottom: 18, left: 6 }}>
      {(dims) => <Inner lines={lines} creditHeadroom={creditHeadroom} dims={dims} />}
    </ResponsiveChart>
  );
}

// Truncate each line at the credit-maxed wall (first balance ≤ −headroom), keeping
// that terminal point so the line visibly hits the wall. A line that never maxes
// keeps its full series.
function truncateAtCredit(series: { date: string; balance: number }[], headroom: number): { date: string; balance: number }[] {
  const floor = -Math.max(0, headroom);
  const idx = series.findIndex((p) => p.balance <= floor);
  return idx === -1 ? series : series.slice(0, idx + 1);
}

// One hoverable column per day-index. All lines share the same day → date mapping
// (each point is a consecutive day from "now"), so a single index spine drives the
// crosshair; only lines still alive at that index contribute a balance row.
interface HoverColumn {
  i: number;
  date: string;
  dotBalance: number; // y of the crosshair dot (actual line if present, else first row)
  rows: { key: string; label: string; balance: number; role: ChartRole }[];
}

function Inner({ lines, creditHeadroom, dims }: { lines: CashflowChartLine[]; creditHeadroom: number; dims: ChartDims }) {
  const { innerWidth, innerHeight, margin } = dims;
  const plotted = lines.map((l) => ({ ...l, series: truncateAtCredit(l.series, creditHeadroom) }));

  const maxLen = Math.max(1, ...plotted.map((l) => l.series.length));
  const maxBal = Math.max(1, ...plotted.flatMap((l) => l.series.map((p) => p.balance)));
  const floor = -Math.max(0, creditHeadroom);

  const x = scaleLinear<number>({ domain: [0, maxLen - 1], range: [margin.left, margin.left + innerWidth] });
  const y = scaleLinear<number>({ domain: [floor, maxBal], range: [margin.top + innerHeight, margin.top] });

  const yZero = y(0);
  const yFloor = y(floor);

  // Build the hover spine: for each day-index, the date + each alive line's balance.
  const columns: HoverColumn[] = [];
  for (let i = 0; i < maxLen; i++) {
    const rows: HoverColumn["rows"] = [];
    let date = "";
    for (const l of plotted) {
      const p = l.series[i];
      if (!p) continue;
      date = p.date;
      const st = LINE_STYLE[l.key] ?? { role: "muted" as ChartRole, width: 1.2 };
      rows.push({ key: l.key, label: l.label, balance: p.balance, role: st.role });
    }
    if (!rows.length) continue;
    const actualRow = rows.find((r) => r.key === "actual");
    columns.push({ i, date, dotBalance: actualRow?.balance ?? rows[0].balance, rows });
  }

  const tip = useChartTooltip<HoverColumn>({
    data: columns,
    getX: (c) => x(c.i),
    getY: (c) => y(c.dotBalance),
  });

  return (
    <>
      <svg width={dims.width} height={dims.height} style={{ touchAction: "none" }} {...tip.handlers}>
        {creditHeadroom > 0 && (
          <rect
            x={margin.left} width={innerWidth}
            y={yZero} height={Math.max(0, yFloor - yZero)}
            fill={chartColor("negative")} opacity={0.08}
          />
        )}
        <ReferenceLine y={yZero} x1={margin.left} x2={margin.left + innerWidth} label="cash gone" />
        {creditHeadroom > 0 && (
          <ReferenceLine y={yFloor} x1={margin.left} x2={margin.left + innerWidth} role="negative" label="credit maxed" />
        )}
        {plotted.map((l) => {
          const st = LINE_STYLE[l.key] ?? { role: "muted" as ChartRole, width: 1.2 };
          return (
            <LinePath<{ date: string; balance: number }>
              key={l.key}
              data={l.series}
              x={(_p, i) => x(i)}
              y={(p) => y(p.balance)}
              stroke={chartColor(st.role)}
              strokeWidth={st.width}
              strokeDasharray={st.dash}
              curve={curveLinear}
              strokeLinecap="round"
            />
          );
        })}
        {tip.tooltipOpen && tip.tooltipData && (
          <Crosshair
            x={x(tip.tooltipData.i)}
            top={margin.top}
            bottom={margin.top + innerHeight}
            cy={y(tip.tooltipData.dotBalance)}
            color={chartColor("positive")}
          />
        )}
        <text x={margin.left + 2} y={margin.top + 8} textAnchor="start" fontSize={9} fill={chartColor("muted")}>
          {formatCurrency(maxBal, { decimals: 0 })}
        </text>
        <text x={margin.left} y={margin.top + innerHeight + 12} textAnchor="start" fontSize={9} fill={chartColor("muted")}>now</text>
      </svg>
      {tip.tooltipOpen && tip.tooltipData && (
        <ChartTooltip left={tip.tooltipLeft ?? 0} top={tip.tooltipTop ?? 0} width={dims.width}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{formatDateShort(tip.tooltipData.date)}</div>
          {tip.tooltipData.rows.map((r) => (
            <div key={r.key} style={{ color: chartColor(r.role) }}>
              {r.label}: {formatCurrency(r.balance, { decimals: 0 })}
            </div>
          ))}
        </ChartTooltip>
      )}
    </>
  );
}
