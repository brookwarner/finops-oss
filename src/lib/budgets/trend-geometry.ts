import type { RagStatus, BudgetKind } from "@/lib/budgets/compute";
import type { HistoryPoint } from "@/lib/budgets/snapshot";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface TrendBar {
  /** Bar magnitude (spend for expenses, income received for income). */
  value: number;
  /** Height as a % of the shared denominator (target-inclusive), 0–100. */
  heightPct: number;
  kind: BudgetKind;
  status: RagStatus;
  /** value ÷ target × 100 — drives income's inverted RAG colour. */
  pctOfTarget: number;
  /** Month abbreviation for the x-axis label. */
  label: string;
  period_start: string;
}

export interface TrendGeometry {
  bars: TrendBar[];
  target: number;
  targetPct: number;
  avg: number;
  avgPct: number;
}

// The bar magnitude for a cycle. Expenses use spend (effective_spend); income is
// an inflow (effective_spend negative), so its bar shows income RECEIVED.
function barValue(p: HistoryPoint): number {
  return p.kind === "income" ? Math.max(0, -p.effective_spend) : Math.max(0, p.effective_spend);
}

// Pure geometry for a category's trend bars. Input is newest-first (as
// getHistoryMap returns); output renders oldest → newest, left → right. Heights
// scale to a denominator that always includes the target, so the target line
// stays on the same axis as the bars.
//
// Expense kinds plot spend, with their stored RAG status; a net-credit cycle
// (negative spend) clamps to a zero bar and is left out of the average. Income
// kinds plot income RECEIVED with inverted RAG (green at/above target). Colour
// mapping is left to the renderer — this returns only domain facts so it stays
// pure and testable.
export function trendBarGeometry(series: HistoryPoint[]): TrendGeometry | null {
  if (series.length < 1) return null;
  const chrono = [...series].reverse();
  const target = chrono[chrono.length - 1].target;

  const values = chrono.map(barValue);
  // Average counts every income cycle, but for expenses skips net-credit cycles
  // (negative effective_spend) so a one-off refund doesn't drag the line down.
  const counted = values.filter((_, i) => chrono[i].kind === "income" || chrono[i].effective_spend >= 0);
  const denom = Math.max(target, 1, ...values);
  const clampPct = (v: number) => Math.min(100, Math.max(0, (v / denom) * 100));
  const avg = counted.length ? counted.reduce((a, b) => a + b, 0) / counted.length : 0;

  const bars: TrendBar[] = chrono.map((p, i) => ({
    value: values[i],
    heightPct: clampPct(values[i]),
    kind: p.kind,
    status: p.status,
    pctOfTarget: target > 0 ? (values[i] / target) * 100 : 0,
    label: MONTHS[Number(p.period_start.slice(5, 7))] ?? "",
    period_start: p.period_start,
  }));
  return { bars, target, targetPct: clampPct(target), avg, avgPct: clampPct(avg) };
}
