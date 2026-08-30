// src/lib/fi/repayment.ts
//
// "What would increasing my mortgage repayments do to my FI date?"
//
// The existing mortgage panel answers "mortgage-free when / interest saved"; the
// FI panel projects a flat contribution forever. Neither links the two. This
// engine does: it runs the SAME today's-dollars FI projection under two arms and
// diffs the FI date.
//
// Modelling choices (confirmed with the user):
//  1. The extra is REALLOCATED FROM INVESTING — a dollar to the mortgage is a
//     dollar not invested. So both arms deploy the *identical* total each month;
//     only the split (mortgage vs invest) and therefore the timing differs. That
//     keeps the comparison fair (no free lunch on either side).
//  2. After payoff the freed scheduled P&I REDIRECTS TO INVESTING. This is the
//     main channel through which extra repayment can actually pull FI forward:
//     clearing the loan ~a decade sooner front-loads that large contribution into
//     more compounding years.
//
// What we deliberately DON'T model: the FI *number* dropping once mortgage
// interest leaves recurring spend. That reduction happens in BOTH arms (just
// sooner in the pay-down arm), so holding it constant is conservative — the real
// edge for paying down is slightly larger than reported. We surface that caveat
// rather than guess how much of today's recurring-spend basis is mortgage
// interest (the trailing window only partially captures a recent loan).
//
// Real-vs-nominal: the projection is in today's (real) dollars; the mortgage
// amortisation is nominal. We compose them the same way the allocation engine
// already does (nominal payoff timing → real-dollar freed contribution), an
// accepted simplification in this codebase.

import { projectVarying, type FIProjection } from "./compute";
import { simulateScenario, type ScenarioPartInput, type ScenarioResult } from "@/lib/mortgage/scenario";

/** The lever-free baseline assembled on the server and handed to the client,
 *  which sets `extraPerMonth` / `lumpSum` and recomputes locally. Dates survive
 *  the RSC boundary; the engine coerces defensively. */
export interface RepaymentFIBase {
  /** Current FI assets (savings + investment pool), today's dollars. */
  startAssets: number;
  /** Actually-saved $/mo (trailing window) — continues in BOTH arms. */
  baseContribution: number;
  realAnnualReturn: number;
  fiNumber: number;
  /** Amortising tranches (annualRate is % p.a. — the ScenarioPartInput contract). */
  mortgageParts: ScenarioPartInput[];
  now: Date | string;
  dob: Date | string;
  /** UI default for the extra-repayment lever (e.g. the planned spare). Engine
   *  ignores it. */
  suggestedExtra?: number;
}

export interface RepaymentLevers {
  extraPerMonth: number;
  lumpSum?: number;
}

export interface RepaymentArm {
  fiMonths: number | null;
  fiDate: string | null;
  fiAge: number | null;
  fiReached: boolean;
  /** When this arm's mortgage clears (months from now / "YYYY-MM"). */
  mortgageFreeMonths: number | null;
  mortgageFreeDate: string | null;
}

export interface RepaymentFIResult {
  extraPerMonth: number;
  lumpSum: number;
  /** Scheduled P&I that frees up at payoff and redirects to investing. */
  freedPayment: number;
  /** Keep investing the extra; mortgage runs to its scheduled payoff. */
  investArm: RepaymentArm;
  /** Throw the extra (and any lump) at the mortgage; clears sooner. */
  payMortgageArm: RepaymentArm;
  /** investArm.fiMonths − payMortgageArm.fiMonths. >0 ⇒ paying down reaches FI
   *  sooner. null when either arm doesn't reach FI within the horizon. */
  monthsSooner: number | null;
  /** Which arm wins on the FI date. "tie" when equal (or neither reaches). */
  verdict: "pay_mortgage" | "invest" | "tie";
  /** The mortgage-only what-if (free-date shift + lifetime interest saved) from
   *  the extra repayment — so the panel needn't recompute it. */
  mortgage: ScenarioResult;
}

const toDate = (d: Date | string): Date => (d instanceof Date ? d : new Date(d));

/** Sum of scheduled monthly repayments across amortising tranches — the cash
 *  that frees up once the mortgage is gone. */
export function freedMonthlyPayment(parts: ScenarioPartInput[]): number {
  return parts.reduce((s, p) => s + Math.max(0, p.monthlyPayment), 0);
}

/** A step contribution: `before` until the mortgage clears at `freeMonths`, then
 *  `after` from that month on. `freeMonths == null` ⇒ never steps up (the loan
 *  doesn't clear in horizon). */
function stepContribution(freeMonths: number | null, before: number, after: number) {
  return (m: number): number => (freeMonths != null && m >= freeMonths ? after : before);
}

export function simulateRepaymentFI(base: RepaymentFIBase, levers: RepaymentLevers): RepaymentFIResult {
  const now = toDate(base.now);
  const dob = toDate(base.dob);
  const extraPerMonth = Math.max(0, levers.extraPerMonth || 0);
  const lumpSum = Math.max(0, levers.lumpSum || 0);
  const parts = base.mortgageParts;
  const freedPayment = freedMonthlyPayment(parts);

  // Mortgage payoff timing: baseline (schedule) vs with the extra repayment + lump.
  const baseline = simulateScenario(parts, now, {});
  const withExtra = simulateScenario(parts, now, {
    extraPerMonth: extraPerMonth || undefined,
    lumpSum: lumpSum || undefined,
  });
  const baseFreeMonths = baseline.baseMonths;
  // `scenMonths` is null when no lever is active; fall back to the baseline payoff.
  const payFreeMonths = withExtra.scenMonths ?? withExtra.baseMonths;

  const common = { realAnnualReturn: base.realAnnualReturn, fiNumber: base.fiNumber, now, dob };

  // Invest arm: extra (and lump) go to investing; mortgage runs to schedule, and
  // its freed payment joins the contribution at the *scheduled* payoff.
  const invest = projectVarying({
    ...common,
    startAssets: base.startAssets + lumpSum,
    contributionAt: stepContribution(
      baseFreeMonths,
      base.baseContribution + extraPerMonth,
      base.baseContribution + extraPerMonth + freedPayment,
    ),
  });

  // Pay-mortgage arm: extra goes to the mortgage (so only the base is invested
  // until payoff), the loan clears earlier, and BOTH the freed payment and the
  // now-free extra redirect to investing from that earlier payoff.
  const payDown = projectVarying({
    ...common,
    startAssets: base.startAssets,
    contributionAt: stepContribution(
      payFreeMonths,
      base.baseContribution,
      base.baseContribution + freedPayment + extraPerMonth,
    ),
  });

  const arm = (p: FIProjection, freeMonths: number | null): RepaymentArm => ({
    fiMonths: p.months,
    fiDate: p.fiDate,
    fiAge: p.fiAge,
    fiReached: p.reached,
    mortgageFreeMonths: freeMonths,
    mortgageFreeDate: freeMonths != null && freeMonths > 0 ? ymFromNow(now, freeMonths) : null,
  });

  const monthsSooner =
    invest.months != null && payDown.months != null ? invest.months - payDown.months : null;
  const verdict: RepaymentFIResult["verdict"] =
    monthsSooner == null
      ? // Tie-break when only one arm reaches: the one that reaches wins.
        payDown.reached && !invest.reached
        ? "pay_mortgage"
        : invest.reached && !payDown.reached
          ? "invest"
          : "tie"
      : monthsSooner > 0
        ? "pay_mortgage"
        : monthsSooner < 0
          ? "invest"
          : "tie";

  return {
    extraPerMonth,
    lumpSum,
    freedPayment,
    investArm: arm(invest, baseFreeMonths),
    payMortgageArm: arm(payDown, payFreeMonths),
    monthsSooner,
    verdict,
    mortgage: withExtra,
  };
}

// "YYYY-MM" `months` from `now` — same convention as the mortgage engine.
function ymFromNow(now: Date, months: number): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
