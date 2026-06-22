import { simulateTranche, monthsToYM } from "./simulate";

// Optional what-if levers, applied to every amortising tranche.
export interface ScenarioInput {
  extraPerMonth?: number;
  lumpSum?: number;
  refixRate?: number; // annual % applied from each tranche's fixed-until date
}

// The minimal per-tranche baseline the scenario math needs. Derived on the server
// from each MortgagePart and serialized to the client unchanged.
export interface ScenarioPartInput {
  balance: number; // magnitude owing
  monthlyPayment: number; // scheduled monthly repayment
  annualRate: number; // % p.a.
  refixMonths: number | null; // whole months until fixed_until (null = floating/unknown)
}

export interface ScenarioPayoff {
  monthsRemaining: number | null;
  freeDate: string | null; // "YYYY-MM"
  totalInterest: number;
  monthsSaved: number | null; // vs the baseline payoff
  interestSaved: number | null;
}

export interface ScenarioResult {
  baseMonths: number | null; // overall (latest-clearing tranche) baseline payoff
  scenMonths: number | null; // overall scenario payoff; null when inactive
  monthsSaved: number | null;
  interestSaved: number | null; // summed across tranches, life-of-loan; null when inactive
  baseFreeDate: string | null;
  scenFreeDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// 0 is a legitimate refix rate, so `refixRate != null` (not `> 0`) flips the lever.
export function scenarioActive(s: ScenarioInput | undefined): boolean {
  return !!s && ((s.extraPerMonth ?? 0) > 0 || (s.lumpSum ?? 0) > 0 || s.refixRate != null);
}

// Per-tranche what-if: simulate baseline and levered, then diff. The refix rate
// applies from this tranche's own fixed-until (refixMonths). Extracted verbatim
// from the former inline block in pi.ts so server and client agree exactly.
export function scenarioPayoffForTranche(
  part: ScenarioPartInput,
  now: Date,
  scenario: ScenarioInput,
): ScenarioPayoff {
  const { balance, monthlyPayment, annualRate, refixMonths } = part;
  const base = simulateTranche({ balance, monthlyPayment, annualRate });
  const sim = simulateTranche({
    balance,
    monthlyPayment,
    annualRate,
    extraPerMonth: scenario.extraPerMonth,
    lumpSum: scenario.lumpSum,
    refixAfterMonths: scenario.refixRate != null ? refixMonths ?? 0 : undefined,
    refixAnnualRate: scenario.refixRate,
  });
  return {
    monthsRemaining: sim.monthsRemaining,
    freeDate: sim.monthsRemaining != null ? monthsToYM(now, sim.monthsRemaining) : null,
    totalInterest: sim.totalInterest,
    monthsSaved:
      base.monthsRemaining != null && sim.monthsRemaining != null
        ? base.monthsRemaining - sim.monthsRemaining
        : null,
    interestSaved: round2(base.totalInterest - sim.totalInterest),
  };
}

// Overall mortgage-free = the latest amortising tranche (the mortgage is gone when
// the last tranche clears). Zero-balance tranches are excluded; null if any tranche
// with a balance can't be projected. THE single roll-up: pi.ts imports and calls
// this too, so the server-side baseline (PWA/API/CLI/MCP) and the client-side
// what-if can never diverge structurally. Callers must pass `months` derived under
// the same `balance > 0 && monthlyPayment > 0` projection guards pi.ts uses — a
// tranche projected on one side but skipped on the other would still diverge.
export function overallMonths(rows: Array<{ balance: number; months: number | null }>): number | null {
  let months: number | null = 0;
  for (const r of rows) {
    if (r.balance <= 0) continue;
    if (r.months == null) return null;
    months = Math.max(months ?? 0, r.months);
  }
  return months;
}

// Client-facing roll-up: baseline + scenario payoff across all tranches.
export function simulateScenario(
  parts: ScenarioPartInput[],
  now: Date,
  scenario: ScenarioInput,
): ScenarioResult {
  const active = scenarioActive(scenario);

  const baseMonthsList = parts.map((p) =>
    p.balance > 0 && p.monthlyPayment > 0
      ? simulateTranche({ balance: p.balance, monthlyPayment: p.monthlyPayment, annualRate: p.annualRate })
          .monthsRemaining
      : null,
  );
  const scen = parts.map((p) =>
    active && p.balance > 0 && p.monthlyPayment > 0 ? scenarioPayoffForTranche(p, now, scenario) : null,
  );

  const baseMonths = overallMonths(parts.map((p, i) => ({ balance: p.balance, months: baseMonthsList[i] })));
  const scenMonths = active
    ? overallMonths(parts.map((p, i) => ({ balance: p.balance, months: scen[i]?.monthsRemaining ?? null })))
    : null;
  const interestSaved = active ? round2(scen.reduce((a, s) => a + (s?.interestSaved ?? 0), 0)) : null;
  const monthsSaved = baseMonths != null && scenMonths != null ? baseMonths - scenMonths : null;

  return {
    baseMonths,
    scenMonths,
    monthsSaved,
    interestSaved,
    // `> 0` mirrors pi.ts's overall payoff guard: an already-cleared loan has no
    // future free-date. (scenFreeDate keeps pi.ts's per-tranche convention.)
    baseFreeDate: baseMonths != null && baseMonths > 0 ? monthsToYM(now, baseMonths) : null,
    scenFreeDate: scenMonths != null ? monthsToYM(now, scenMonths) : null,
  };
}
