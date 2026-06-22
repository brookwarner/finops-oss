// src/lib/cashflow/engine.ts
// Pure cashflow engine — no Supabase, no server imports. Safe to import from
// client components. `buildLines` walks four scenario balance lines (actual /
// on-budget / bare-essentials / custom) forward across the horizon by composing
// the forecast event projectors.

import {
  inferIncomeStreams, projectIncomeEvents, projectCommittedEvents, projectVariableBurn,
  projectActualBurn, nextBillCluster,
  type ForecastEvent, type IncomeTxn, type MonthlyIncomeFallback, type CommittedBudget,
  type CapBudget, type ActualCap,
} from "@/lib/forecast/events";

/** Weekly-equivalent of the income the engine actually projects forward (inferred
 *  recurring pay streams, else the monthly budget fallback). This is the baseline
 *  the "Add income" what-if stacks ON TOP of — exposed so the UI can label it.
 *  Note: irregular/one-off income (e.g. a receivership employer's wages) is
 *  intentionally excluded upstream by `loadIncomeTxns`, so it never lands here. */
function baselineWeeklyIncome(incomeTxns: IncomeTxn[], fallback: MonthlyIncomeFallback | null, now: Date): number {
  const streams = inferIncomeStreams(incomeTxns, now);
  if (streams.length) {
    return streams.reduce((s, st) => s + (st.amount * 7) / st.intervalDays, 0);
  }
  if (fallback) return (fallback.amount * 12) / 52; // monthly → weekly
  return 0;
}
import { walkSeries } from "@/lib/forecast/walk";
import { isEssential } from "@/lib/spend/classify";
import { lineZero, creditZero, weeksToCredit, SCENARIO_LABEL, type ScenarioKey, type CashflowToggles, type SeriesPoint } from "./scenario";
import { type Inflow } from "./inflows";

export const DAY_MS = 86_400_000;
// Long enough that even the slowest line (bare essentials with the lump landed)
// reaches its zero crossing within the walk; clamps an unbounded "covered" line.
export const HORIZON_CAP_DAYS = 550;
export function iso(d: Date): string { return d.toISOString().slice(0, 10); }

export interface BuildLinesArgs {
  now: Date;
  horizonDays: number;
  startLiquid: number;
  cycleLength: number;
  incomeTxns: IncomeTxn[];
  incomeFallback: MonthlyIncomeFallback | null;
  actualCaps: ActualCap[];
  budgetCaps: CapBudget[];
  committed: CommittedBudget[];
  toggles: CashflowToggles;
  inflows: Inflow[];
  receivables: number;
  creditHeadroom: number;
}

export interface CashflowLine {
  key: ScenarioKey; label: string;
  series: SeriesPoint[];
  cashZeroDate: string | null;
  creditZeroDate: string | null;
  weeksToCredit: number | null;
}

export interface CashflowResult {
  startLiquid: number;
  creditHeadroom: number;
  lines: CashflowLine[];
  inflows: Inflow[];
  events: ForecastEvent[];
  nextBills: { date: string; amount: number; count: number } | null;
  verdict: { makesIt: boolean; margin: number };
  context: { receivables: number; baselineWeeklyIncome: number };
}

/** Income events for the walk: inferred pay streams (or the monthly fallback),
 *  plus an optional weekly what-if top-up. */
function incomeEvents(a: BuildLinesArgs, addWeekly: number): ForecastEvent[] {
  const streams = inferIncomeStreams(a.incomeTxns, a.now);
  const base = streams.length
    ? streams.flatMap((s) => projectIncomeEvents(s, null, a.now, a.horizonDays))
    : projectIncomeEvents(null, a.incomeFallback, a.now, a.horizonDays);
  if (addWeekly > 0) {
    for (let i = 7; i <= a.horizonDays; i += 7) {
      const d = new Date(a.now.getTime() + i * DAY_MS);
      base.push({ date: iso(d), delta: addWeekly, label: "Extra income (what-if)", kind: "income" });
    }
  }
  const lumps = a.toggles.lumps ?? {};
  const end = new Date(a.now.getTime() + a.horizonDays * DAY_MS);
  for (const inflow of a.inflows) {
    const landDate = lumps[inflow.id];
    if (!landDate) continue;
    const d = new Date(`${landDate}T00:00:00Z`);
    if (d >= a.now && d <= end) {
      const net = Math.round(inflow.amount * (1 - inflow.taxRate) * 100) / 100;
      base.push({ date: iso(d), delta: net, label: `Expected: ${inflow.label}`, kind: "income" });
    }
  }
  return base;
}

/** The dated event drivers for one scenario line. The burn source + which bills
 *  apply differ per line; income is shared (only the what-if top-up varies). */
function scenarioEvents(key: ScenarioKey, a: BuildLinesArgs): ForecastEvent[] {
  const income = incomeEvents(a, a.toggles.addIncomeWeekly ?? 0);
  let burn: ForecastEvent[];
  let bills: CommittedBudget[];
  if (key === "onBudget") {
    // On budget: every cap runs to its monthly target, all bills paid.
    burn = projectVariableBurn(a.budgetCaps, a.cycleLength, a.now, a.horizonDays);
    bills = a.committed;
  } else if (key === "bareEssentials") {
    // Bare essentials: discretionary daily burn paused (factor 0), only
    // essential bills paid.
    burn = projectActualBurn(a.actualCaps, a.now, a.horizonDays, 0);
    bills = a.committed.filter((b) => isEssential(b.spendClass));
  } else if (key === "custom") {
    // Custom: discretionary burn scaled by the cut %, all bills paid.
    const factor = 1 - Math.min(100, Math.max(0, a.toggles.customCutPct ?? 0)) / 100;
    burn = projectActualBurn(a.actualCaps, a.now, a.horizonDays, factor);
    bills = a.committed;
  } else {
    // Actual pace: full trailing burn, all bills paid.
    burn = projectActualBurn(a.actualCaps, a.now, a.horizonDays, 1);
    bills = a.committed;
  }
  const committedEvents = projectCommittedEvents(bills, a.now, a.horizonDays);
  return [...income, ...committedEvents, ...burn].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
}

/** Pure core: build the four scenario balance lines + verdict against the next
 *  bill cluster. Deterministic given `now`. */
export function buildLines(a: BuildLinesArgs): CashflowResult {
  const start = a.startLiquid;
  const aStart = { ...a, startLiquid: start };
  const keys: ScenarioKey[] = ["actual", "onBudget", "bareEssentials", "custom"];
  const lines: CashflowLine[] = keys.map((key) => {
    const events = scenarioEvents(key, aStart);
    const series = walkSeries(a.now, a.horizonDays, start, events);
    return {
      key, label: SCENARIO_LABEL[key], series,
      cashZeroDate: lineZero(series),
      creditZeroDate: creditZero(series, a.creditHeadroom),
      weeksToCredit: weeksToCredit(series, a.creditHeadroom),
    };
  });
  const actualEvents = scenarioEvents("actual", aStart);
  const nb = nextBillCluster(actualEvents, a.now);
  const actualSeries = lines.find((l) => l.key === "actual")!.series;
  // Verdict margin: the lowest the actual line dips through the next bill cluster
  // (the upcoming stressor), or the overall trough when there's no future bill.
  // Mirrors forecast/compute.ts: seed the trough reduce with window[0], clamp
  // the cutoff to the last series date (+1 day grace, same as GRACE_DAYS=1).
  const lastDate = actualSeries.length ? actualSeries[actualSeries.length - 1].date : iso(a.now);
  let cutoff: string;
  if (nb) {
    const graced = iso(new Date(Date.parse(`${nb.endDate}T00:00:00Z`) + DAY_MS));
    cutoff = graced < lastDate ? graced : lastDate;
  } else {
    cutoff = lastDate;
  }
  const window = actualSeries.filter((p) => p.date <= cutoff);
  const troughPoint = window.length
    ? window.reduce((lo, p) => (p.balance < lo.balance ? p : lo), window[0])
    : { date: iso(a.now), balance: start };
  const margin = troughPoint.balance;
  return {
    startLiquid: start,
    creditHeadroom: a.creditHeadroom,
    lines,
    inflows: a.inflows,
    events: actualEvents,
    nextBills: nb ? { date: nb.date, amount: nb.amount, count: nb.count } : null,
    verdict: { makesIt: margin >= 0, margin: Math.round(margin * 100) / 100 },
    context: {
      receivables: a.receivables,
      baselineWeeklyIncome: baselineWeeklyIncome(a.incomeTxns, a.incomeFallback, a.now),
    },
  };
}
