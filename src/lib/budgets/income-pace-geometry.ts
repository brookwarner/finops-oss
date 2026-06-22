// Pure geometry for the income pace chart (Card 3, hybrid). Consumes a per-cycle
// income series adapted at the wiring boundary from the income-trend feature's
// IncomeHistory (src/lib/income/history.ts) — each of their IncomeCyclePoint
// {period_start, total, plannedTotal, ...} maps to one IncomePoint here. The type
// is named IncomePoint (NOT IncomeCyclePoint) to avoid colliding with that export.

export interface IncomePoint {
  /** Cycle boundary (the 20th), ISO date. */
  periodStart: string;
  /** Short x-axis label, e.g. "Feb". */
  label: string;
  /** Total income that cycle. */
  total: number;
  /** True for the in-progress (partial) cycle. */
  isCurrent: boolean;
}

export interface IncomeBar {
  label: string;
  total: number;
  /** height as % of scaleMax (0–100). */
  heightPct: number;
  isCurrent: boolean;
}

export interface IncomePaceGeometry {
  bars: IncomeBar[];
  scaleMax: number;
  /** plan reference line as % of scaleMax. */
  planPct: number;
  /** pace marker over the current bar; null when no current cycle. */
  paceMarker: { barIndex: number; heightPct: number } | null;
  planned: number;
  expectedByNow: number;
}

// Bars are income per cycle (oldest→newest as given); the plan line and the
// current-cycle pace marker share the bars' scale so they're directly comparable.
export function incomePaceGeometry(
  series: IncomePoint[],
  planned: number,
  expectedByNow: number,
): IncomePaceGeometry {
  const maxTotal = series.reduce((m, p) => Math.max(m, p.total), 0);
  const scaleMax = Math.max(maxTotal, planned, expectedByNow, 1) * 1.05;
  const pct = (v: number) => (v / scaleMax) * 100;

  const bars: IncomeBar[] = series.map((p) => ({
    label: p.label,
    total: p.total,
    heightPct: pct(p.total),
    isCurrent: p.isCurrent,
  }));

  const currentIndex = series.findIndex((p) => p.isCurrent);
  const paceMarker =
    currentIndex >= 0 ? { barIndex: currentIndex, heightPct: pct(expectedByNow) } : null;

  return { bars, scaleMax, planPct: pct(planned), paceMarker, planned, expectedByNow };
}
