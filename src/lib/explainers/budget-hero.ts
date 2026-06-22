// Pure content-builders for the budget hero explainer sheets (PWA `/budgets`).
//
// Each builder takes one of the page's already-computed objects (`position`
// from `src/lib/budgets/position.ts`, `forecast` from
// `src/lib/forecast/compute.ts`) and returns a plain `Explainer` — a legend
// mapping every number on the card to a plain-English meaning, with this
// cycle's live values plugged in. No re-querying, no re-calculation: the values
// are read straight off the source objects so they can't drift from the card.
//
// Builders mirror the card's own conditionals (run-rate row only when
// `planned > 0`; bills-vs-pay line depends on `forecast.billsDue`) so the
// legend never lists a line the card isn't showing.

import { formatCurrency } from "@/lib/format";
import type { Position } from "@/lib/budgets/position";
import type { ForecastResult } from "@/lib/forecast/compute";
import type { DailyBurnResult } from "@/lib/spend/daily-burn";

export interface ExplainerRow {
  /** The number/line as it appears on the card, e.g. "+$990 on pace". */
  line: string;
  /** Plain-English meaning, e.g. "Projected end-of-cycle surplus…". */
  meaning: string;
}

export interface Explainer {
  title: string;
  /** One-sentence "what question does this card answer". */
  answers: string;
  rows: ExplainerRow[];
}

/** Magnitude only, 0dp — matches the cards' bare dollar idiom. */
function money(n: number): string {
  return formatCurrency(n, { decimals: 0, signDisplay: "never" });
}

/** Signed, 0dp — for the +$990 / −$1,958 headline lines. */
function signedMoney(n: number): string {
  return formatCurrency(n, { decimals: 0, signDisplay: "always" });
}

export function explainPosition(position: Position): Explainer {
  const { income, expenses, net } = position;

  const rows: ExplainerRow[] = [
    {
      line: `${signedMoney(net.projected)} projected by cycle end`,
      meaning: `Projected end-of-cycle net — expected income (${money(income.expected)}, the greater of actual ${money(income.actual)} and plan ${money(income.planned)}) minus projected spend (${money(expenses.projected)}).`,
    },
    {
      line: `${signedMoney(net.actual)} so far`,
      meaning: `Pure actual: income in (${money(income.actual)}) − spend out (${money(expenses.actual)}), as of today. Mid-cycle this often reads negative because pay lands weekly while bills hit early.`,
    },
    {
      line: `In ${money(income.actual)} → ${money(income.expected)}`,
      meaning: "Income received so far, projecting to the full-cycle expectation (the hatched bar).",
    },
    {
      line: `Out ${money(expenses.actual)} → ${money(expenses.projected)}`,
      meaning: "Spend so far, projecting to the full-cycle estimate (the hatched bar).",
    },
  ];

  if (expenses.pending > 0) {
    rows.push({
      line: `+${money(expenses.pending)} pending`,
      meaning: "Spent at the bank but not yet settled — folded into the projection, not yet attributed to any single budget.",
    });
  }

  return {
    title: "Position",
    answers: "Will this cycle end in surplus?",
    rows,
  };
}

export function explainSpendingVsPlan(position: Position): Explainer {
  const { income, expenses, net } = position;
  const capsUsed = expenses.budget > 0 ? Math.round((expenses.actual / expenses.budget) * 100) : 0;

  const rows: ExplainerRow[] = [
    {
      line: `spent ${money(expenses.actual)}`,
      meaning: "Actual spend so far this cycle (the warm fill).",
    },
    {
      line: `caps ${money(expenses.budget)}`,
      meaning: `Sum of your budget caps. ${capsUsed}% used so far.`,
    },
  ];

  if (income.planned > 0 && expenses.budget > 0) {
    rows.push({
      line: `${signedMoney(net.planned)}/mo ${net.planned >= 0 ? "headroom" : "over"}`,
      meaning: `Structure: caps (${money(expenses.budget)}/mo) against planned income (${money(income.planned)}/mo). Positive = the budgets you've SET fit inside what you plan to earn; negative = over-committed — independent of how this cycle is tracking.`,
    });
  }

  return {
    title: "Spending vs plan",
    answers: "Do my caps fit inside my income, and how much have I used?",
    rows,
  };
}

export function explainBills(forecast: ForecastResult): Explainer {
  const { trough, billsDue, nextPayday } = forecast;

  const rows: ExplainerRow[] = [
    {
      line: `${money(trough.balance)} to spare`,
      meaning: "The lowest your everyday-account balance dips to before the next bills clear.",
    },
    {
      // Dates are raw ISO strings shown as-is on the card — pass through verbatim.
      line: `Lowest ${money(trough.balance)} on ${trough.date}`,
      meaning: "The date that low point lands.",
    },
  ];

  // Mirror the card: it shows the next bill cluster if there is one, else the
  // next payday, else nothing.
  if (billsDue) {
    rows.push({
      line: `bills ${billsDue.date}`,
      meaning: "When the next cluster of bills is due.",
    });
  } else if (nextPayday) {
    rows.push({
      line: `pay ${nextPayday.date}`,
      meaning: "When the next payday lands (no bills before then).",
    });
  }

  return {
    title: "Can I pay my bills?",
    answers: "Will my bank balance survive until the next bills clear?",
    rows,
  };
}

export function explainDailyBurn(burn: DailyBurnResult): Explainer {
  const rows: ExplainerRow[] = [
    {
      line: `${money(burn.trailingPerDay)}/day`,
      meaning: `The headline — your trailing ${burn.trailingDays}-day average daily burn (the solid line). ${
        burn.priorPerDay != null
          ? `${burn.trend >= 0 ? "Up" : "Down"} ${money(Math.abs(burn.trend))}/day from the prior ${burn.trailingDays} days (${money(burn.priorPerDay)}/day).`
          : `Cycle average so far is ${money(burn.cyclePerDay)}/day.`
      } "Burn" is spend in your monthly-cap (variable) categories — the same set the forecast drags as daily burn.`,
    },
    {
      line: `${signedMoney(burn.vsPlan)}/day vs plan`,
      meaning: `Trailing daily burn (${money(burn.trailingPerDay)}/day) minus the planned daily figure (${money(burn.plannedPerDay)}/day). Positive = burning hotter than plan.`,
    },
    {
      line: `plan ${money(burn.plannedPerDay)}/day`,
      meaning: "The dashed reference line — Σ of your active monthly-cap budgets ÷ days in the cycle.",
    },
    {
      line: `spent ${money(burn.spentSoFar)} so far`,
      meaning: `Variable spend across day 1–${burn.dayOfPeriod} of ${burn.periodLength}. Each bar is one day; days over plan show red. Refunds net within a day, so a heavy-refund day can read as zero.`,
    },
  ];

  return {
    title: "Daily burn",
    answers: "Is my day-to-day spending pace running hotter or cooler than plan?",
    rows,
  };
}

export function explainIncomePace(position: Position): Explainer {
  const { income } = position;
  const vsPlan = income.recentRunRate - income.planned;

  return {
    title: "Income pace",
    answers: "Is my income keeping up with the plan?",
    rows: [
      {
        line: `${signedMoney(vsPlan)}/mo vs plan`,
        meaning: `Trailing run-rate (${money(income.recentRunRate)}/mo) minus planned income (${money(income.planned)}/mo). Negative = earning below plan — e.g. the receivership / weekly-pay shortfall.`,
      },
      {
        line: `pace ${money(income.expectedByNow)}`,
        meaning: `Where the plan says income should be by today (plan × fraction of cycle elapsed). The marker over the current bar; income so far is ${money(income.actual)}.`,
      },
      {
        line: `plan ${money(income.planned)}/mo`,
        meaning: "The dashed reference line — Σ of your active income budgets per cycle.",
      },
    ],
  };
}
