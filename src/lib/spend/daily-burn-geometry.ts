import type { DailyBurnResult } from "./daily-burn";

// Pure geometry for the daily-burn sparkbar chart. One bar per elapsed day,
// scaled to a denominator that always includes the plan + trailing lines so they
// stay on the same axis as the bars. Days over the planned daily figure are
// flagged so the renderer can colour them hot. Oldest → newest as given.

export interface BurnBar {
  date: string;
  spend: number;
  /** Height as % of scaleMax (0–100); a refund (negative) day clamps to 0. */
  heightPct: number;
  /** spend > plannedPerDay — a day that ran hotter than plan. */
  overPlan: boolean;
  /** Day-of-month label (e.g. "21"), for sparse axis ticks. */
  label: string;
}

export interface DailyBurnGeometry {
  bars: BurnBar[];
  scaleMax: number;
  /** Planned daily figure as % of scaleMax — the dashed reference line. */
  planPct: number;
  /** Trailing-average daily burn as % of scaleMax — the solid pace line. */
  trailingPct: number;
}

export function dailyBurnGeometry(r: DailyBurnResult): DailyBurnGeometry {
  const maxDay = r.days.reduce((m, d) => Math.max(m, d.spend), 0);
  const scaleMax = Math.max(maxDay, r.plannedPerDay, r.trailingPerDay, 1) * 1.05;
  const pct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));

  const bars: BurnBar[] = r.days.map((d) => ({
    date: d.date,
    spend: d.spend,
    heightPct: pct(d.spend),
    overPlan: d.spend > r.plannedPerDay,
    label: d.date.slice(8, 10),
  }));

  return { bars, scaleMax, planPct: pct(r.plannedPerDay), trailingPct: pct(r.trailingPerDay) };
}
