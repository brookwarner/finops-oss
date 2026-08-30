// src/lib/cashflow/scenario.ts
// Pure helpers for the cashflow game-plan: scenario typing + reading a balance
// series for its zero-date / weeks-left. The per-scenario event derivation lives
// in compute.ts (it composes the forecast event projectors); these are the small
// pure readouts the chart/CLI/MCP share.

export type { Inflow } from "./inflows";

export type ScenarioKey = "actual" | "onBudget" | "bareEssentials" | "custom";

export interface CashflowToggles {
  lumps?: Record<string, string>; // inflow id → land-date ISO (presence = enabled)
  addIncomeWeekly?: number;
  customCutPct?: number; // 0..100; only the "custom" line uses it
}

export interface SeriesPoint { date: string; balance: number }

const DAY_MS = 86_400_000;

/** First date the running balance is ≤ 0; null when it never crosses (covered). */
export function lineZero(series: SeriesPoint[]): string | null {
  for (const p of series) if (p.balance <= 0) return p.date;
  return null;
}

/** Whole weeks from the series start to its zero date; null when covered. */
export function weeksToZero(series: SeriesPoint[]): number | null {
  const zero = lineZero(series);
  if (zero == null || series.length === 0) return null;
  const start = Date.parse(`${series[0].date}T00:00:00Z`);
  const end = Date.parse(`${zero}T00:00:00Z`);
  return Math.round((end - start) / (7 * DAY_MS));
}

/** First date the balance is ≤ −headroom (credit exhausted); null if never. */
export function creditZero(series: SeriesPoint[], headroom: number): string | null {
  const floor = -Math.max(0, headroom);
  for (const p of series) if (p.balance <= floor) return p.date;
  return null;
}

/** Whole weeks from the series start to the credit-exhausted date; null if never. */
export function weeksToCredit(series: SeriesPoint[], headroom: number): number | null {
  const zero = creditZero(series, headroom);
  if (zero == null || series.length === 0) return null;
  const start = Date.parse(`${series[0].date}T00:00:00Z`);
  const end = Date.parse(`${zero}T00:00:00Z`);
  return Math.round((end - start) / (7 * DAY_MS));
}

export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  actual: "Actual pace",
  onBudget: "On budget",
  bareEssentials: "Bare essentials",
  custom: "Custom",
};
