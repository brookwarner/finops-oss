import type { IncomeCyclePoint } from "./history";

export interface IncomeTrendSegment {
  categoryId: string;
  name: string;
  actual: number;
  plan: number;
  fracStart: number;
  fracEnd: number;
  alpha: number;
}
export interface IncomeTrendBar {
  period_start: string;
  label: string;
  total: number;
  plannedTotal: number;
  totalFrac: number;
  segments: IncomeTrendSegment[];
}
export interface IncomeTrendGeometry {
  bars: IncomeTrendBar[];
  planFrac: number;
  scaleMax: number;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return MONTHS[m - 1] ?? iso.slice(0, 7);
}
function alphaFor(index: number): number {
  return Math.max(0.3, 1 - index * 0.18);
}

/**
 * Pure geometry for the income stacked-bar chart. Input is newest-first (as the
 * API returns); output bars are oldest-first (left-to-right). Heights are
 * fractions of `scaleMax` = max over all cycles of max(total, plannedTotal), so
 * the flat plan line and the tallest actual both fit. Returns null when there is
 * nothing to scale (no cycles, or every total and plan is 0).
 */
export function incomeTrendGeometry(cyclesNewestFirst: IncomeCyclePoint[]): IncomeTrendGeometry | null {
  if (!cyclesNewestFirst.length) return null;
  const scaleMax = Math.max(
    ...cyclesNewestFirst.map((c) => Math.max(c.total, c.plannedTotal)),
  );
  if (scaleMax <= 0) return null;
  const plannedTotal = Math.max(...cyclesNewestFirst.map((c) => c.plannedTotal));

  const bars: IncomeTrendBar[] = [...cyclesNewestFirst].reverse().map((c) => {
    let cum = 0;
    const segments: IncomeTrendSegment[] = c.sources.map((s, i) => {
      const fracStart = cum / scaleMax;
      cum += s.actual;
      return {
        categoryId: s.categoryId, name: s.name, actual: s.actual, plan: s.plan,
        fracStart, fracEnd: cum / scaleMax, alpha: alphaFor(i),
      };
    });
    return {
      period_start: c.period_start, label: monthLabel(c.period_start),
      total: c.total, plannedTotal: c.plannedTotal, totalFrac: c.total / scaleMax, segments,
    };
  });
  return { bars, planFrac: plannedTotal / scaleMax, scaleMax };
}
