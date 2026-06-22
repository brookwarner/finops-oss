// src/lib/allocation/compute.ts
import { type ScenarioPartInput } from "@/lib/mortgage/scenario";
import { simulateRepaymentFI } from "@/lib/fi/repayment";
import { formatCurrency } from "@/lib/format";

const money = (n: number) => formatCurrency(n, { decimals: 0 });
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`;
const capitalise = (s: string) => (s.length ? s[0].toUpperCase() + s.slice(1) : s);

// 19 → "1 yr 7 mo"; 12 → "1 yr"; 7 → "7 mo"; ≤0 → "—".
export function durationLabel(months: number | null): string {
  if (months == null || months <= 0) return "—";
  const y = Math.floor(months / 12);
  const mo = months % 12;
  if (y === 0) return `${mo} mo`;
  if (mo === 0) return `${y} yr`;
  return `${y} yr ${mo} mo`;
}

// Rate-unit convention (foot-gun guard): rates arrive on this boundary in TWO
// units. `visa.apr` is a FRACTION (0.1995 = 19.95%). `mortgageParts[].annualRate`
// is a PERCENT (6.1 = 6.1% p.a.) — it's the existing ScenarioPartInput contract.
// The engine reconciles them internally (avgMortgageRate returns % and is /100'd
// before display). Callers assembling this input must honour both units.
export interface AllocationInput {
  surplusPerMonth: number;
  lumpSum: number; // 0 if none
  visa: { balance: number; apr: number } | null; // balance = positive magnitude owed; apr = FRACTION (e.g. 0.1995)
  // Redrawable revolving loan (the Westpac Choices facility). balance = positive
  // magnitude owed; rate = FRACTION (e.g. 0.0569). null when nothing is owed.
  revolvingLoan: { name: string; balance: number; rate: number } | null;
  reserves: { name: string; shortfall: number }[]; // shortfall > 0 = behind
  // Emergency fund (cash buffer): shortfall = target − balance (>0 = under-funded);
  // null when no account is designated. Funded after the revolving loan, before the
  // mortgage-vs-invest fork — liquidity safety before long-term optimisation.
  emergencyFund: { name: string; shortfall: number; targetMonths: number; monthsCovered: number | null } | null;
  mortgageParts: ScenarioPartInput[]; // annualRate is % p.a. (ScenarioPartInput contract)
  fi: {
    vsTargetYears: number | null; // fiAge − targetAge; ≤0 on track, >0 or null behind
    monthlyContribution: number;
    startAssets: number;
    fiNumber: number;
    realReturn: number;
    dob: Date;
  };
  assumedInflation: number;
  now: Date;
}

export type RungKey = "debt" | "reserve" | "revolving" | "emergency" | "mortgage" | "invest";
export interface RungLine { label: string; value: string }
export interface Rung {
  key: RungKey;
  title: string;
  amount: number; // this-cycle dollars routed here
  tag: { text: string; cls: "guaranteed" | "need" | "risky" };
  detail: { lines: RungLine[]; why: string };
}
/** The final mortgage-vs-investments fork as a head-to-head: route the spare to
 *  whichever reaches FI sooner. Both sides carry their FI outcome so a surface
 *  can show "if invest → X | if mortgage → Y" rather than only the winner. */
export interface AllocationFork {
  routed: number;                 // this-cycle dollars to the chosen destination
  choice: "mortgage" | "invest";
  freedPayment: number;           // scheduled P&I that redirects to investing at payoff
  /** invest.fiMonths − payMortgage.fiMonths (months). >0 ⇒ paying down reaches FI
   *  sooner; <0 ⇒ investing does; null when an arm doesn't reach FI in horizon. */
  monthsSooner: number | null;
  mortgageRate: number;           // fraction (0.0499 = 4.99%)
  nominalReturn: number;          // fraction — assumed investment return
  invest: { fiDate: string | null; fiAge: number | null; fiReached: boolean };
  payMortgage: {
    fiDate: string | null; fiAge: number | null; fiReached: boolean;
    mortgageFreeDate: string | null; interestSaved: number | null;
  };
}
export interface AllocationResult {
  surplus: number;
  lumpSum: number;
  total: number; // surplus + lump (this-cycle pool)
  rungs: Rung[];
  recommendation: string;
  headline: { kind: "mortgage" | "fi" | "none"; label: string; sublabel: string };
  recurringChoice: "mortgage" | "invest" | "none";
  /** Head-to-head behind the final rung (the same simulation that picked `choice`). */
  mortgageVsInvest: AllocationFork;
}

/** Balance-weighted average annual rate across amortising tranches (% p.a.). */
export function avgMortgageRate(parts: ScenarioPartInput[]): number {
  let bal = 0;
  let weighted = 0;
  for (const p of parts) {
    if (p.balance <= 0) continue;
    bal += p.balance;
    weighted += p.balance * p.annualRate;
  }
  return bal > 0 ? weighted / bal : 0;
}

export function computeAllocation(input: AllocationInput): AllocationResult {
  const surplus = Math.max(0, input.surplusPerMonth);
  const lumpSum = Math.max(0, input.lumpSum);
  const total = surplus + lumpSum;
  const rungs: Rung[] = [];
  let rem = total;

  // 1. High-interest debt — cleared first; nothing beats a ~20% guaranteed return.
  if (input.visa && input.visa.balance > 0 && rem > 0) {
    const amt = Math.min(rem, input.visa.balance);
    rem -= amt;
    const still = input.visa.balance - amt;
    rungs.push({
      key: "debt",
      title: "Credit card",
      amount: amt,
      tag: { text: `${pct(input.visa.apr)} · guaranteed`, cls: "guaranteed" },
      detail: {
        lines: [
          { label: "Balance owing", value: money(input.visa.balance) },
          { label: "Cleared this cycle", value: money(amt) },
          ...(still > 0 ? [{ label: "Still owing after", value: money(still) }] : []),
        ],
        why: `At ${pct(input.visa.apr)}, revolving card debt is the highest guaranteed return available — clearing it beats every other use of a dollar.`,
      },
    });
  }

  // 2. Reserves behind — fund shortfalls, largest first, no cap. A behind reserve
  //    is a near-certain cost you'd otherwise borrow for at ~the mortgage rate.
  const behind = input.reserves.filter((r) => r.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall);
  for (const r of behind) {
    if (rem <= 0) break;
    const amt = Math.min(rem, r.shortfall);
    rem -= amt;
    rungs.push({
      key: "reserve",
      title: r.name,
      amount: amt,
      tag: { text: `${money(r.shortfall)} behind`, cls: "need" },
      detail: {
        lines: [
          { label: "Shortfall", value: money(r.shortfall) },
          { label: "Topped up", value: money(amt) },
        ],
        why: `This sinking fund is ${money(r.shortfall)} behind its accrual. Funding it earns roughly your mortgage rate — money you'd otherwise borrow when the cost lands — plus the certainty of not being caught short.`,
      },
    });
  }

  // 3. Revolving loan (Choices) — redrawable debt at a guaranteed floating rate.
  //    Ranked ABOVE the amortising mortgage: same ~guaranteed tax-free return, but
  //    the paydown is reversible (redraw up to the limit), so at an equal rate it
  //    wins on flexibility. Funded from the remaining pool, capped at the balance.
  if (input.revolvingLoan && input.revolvingLoan.balance > 0 && rem > 0) {
    const amt = Math.min(rem, input.revolvingLoan.balance);
    rem -= amt;
    const still = input.revolvingLoan.balance - amt;
    rungs.push({
      key: "revolving",
      title: input.revolvingLoan.name,
      amount: amt,
      tag: { text: `${pct(input.revolvingLoan.rate)} · guaranteed`, cls: "guaranteed" },
      detail: {
        lines: [
          { label: "Balance owing", value: money(input.revolvingLoan.balance) },
          { label: "Paid down this cycle", value: money(amt) },
          ...(still > 0 ? [{ label: "Still owing after", value: money(still) }] : []),
        ],
        why: `A revolving facility at ${pct(input.revolvingLoan.rate)} floating. Paying it down earns a guaranteed ${pct(input.revolvingLoan.rate)} tax-free — and because it's non-reducing and redrawable up to its limit, the paydown is reversible, so it ranks above the fixed mortgage at the same rate. Redraw it if a cost lands.`,
      },
    });
  }

  // 4. Emergency fund — top up to the target (N months of essentials) before any
  //    long-term optimisation. Liquidity safety outranks the mortgage and
  //    investments; it sits below the revolving loan (still cheaper than carrying
  //    high-rate debt) and below behind-reserves (near-certain dated costs).
  if (input.emergencyFund && input.emergencyFund.shortfall > 0 && rem > 0) {
    const ef = input.emergencyFund;
    const amt = Math.min(rem, ef.shortfall);
    rem -= amt;
    const covered = ef.monthsCovered != null ? `${ef.monthsCovered.toFixed(1)} of ${ef.targetMonths} mo` : `${ef.targetMonths} mo target`;
    rungs.push({
      key: "emergency",
      title: ef.name,
      amount: amt,
      tag: { text: `${money(ef.shortfall)} short`, cls: "need" },
      detail: {
        lines: [
          { label: "Shortfall to target", value: money(ef.shortfall) },
          { label: "Topped up", value: money(amt) },
          { label: "Cover", value: covered },
        ],
        why: `Your emergency fund is ${money(ef.shortfall)} below its ${ef.targetMonths}-month target. Cash for an income shock or surprise comes before paying down the mortgage or investing — it's the liquidity that stops a shock turning into high-interest debt.`,
      },
    });
  }

  // 5. Mortgage vs investments — the remainder, decided by the repayment→FI sim.
  // Backlog (debt + revolving + reserves + emergency fund) is one-off, so it's
  // funded from the lump first; the recurring monthly surplus reaches the fork.
  const backlogTotal = total - rem;
  const lumpToRecurring = Math.max(0, lumpSum - backlogTotal);
  const steadyMonthly = surplus;

  const nominalReturn = input.fi.realReturn + input.assumedInflation;
  const mortgageRate = avgMortgageRate(input.mortgageParts) / 100; // % → fraction

  // The mortgage-vs-invest call is no longer a heuristic ("are you on track for
  // age-50 FI?") — it's the actual repayment→FI simulation. Route the recurring
  // spare (+ any lump surviving the backlog) to whichever arm reaches FI sooner,
  // both deploying the same money (the sim models the freed-payment redirect once
  // the loan clears). A tie goes to the mortgage — the certain, debt-clearing
  // option. This keeps the cascade and the /investments "Repayments → FI" panel
  // always in agreement: both are driven by simulateRepaymentFI.
  const repaymentFI = simulateRepaymentFI(
    {
      startAssets: input.fi.startAssets,
      baseContribution: input.fi.monthlyContribution,
      realAnnualReturn: input.fi.realReturn,
      fiNumber: input.fi.fiNumber,
      mortgageParts: input.mortgageParts,
      now: input.now,
      dob: input.fi.dob,
    },
    { extraPerMonth: steadyMonthly, lumpSum: lumpToRecurring },
  );
  const { investArm, payMortgageArm, mortgage: sim, monthsSooner } = repaymentFI;
  const choice: "mortgage" | "invest" = repaymentFI.verdict === "invest" ? "invest" : "mortgage";

  let headline: AllocationResult["headline"] = { kind: "none", label: "—", sublabel: "" };
  let recurringTitle = "";

  // Pure formatting, identical in both branches — the recurring contribution as
  // "$X / mo" (+ "$Y now" when a lump survives the backlog).
  const extraText = lumpToRecurring > 0
    ? `${money(steadyMonthly)} / mo + ${money(lumpToRecurring)} now`
    : `${money(steadyMonthly)} / mo`;

  // Head-to-head FI impact: how much sooner the CHOSEN arm reaches FI than the
  // other use of the same money. Falls back to the chosen arm's FI date when the
  // margin isn't measurable (a tie, or the alternative never reaches FI).
  const fiHeadline = (sooner: number | null, fromDate: string | null, toDate: string | null, chosenDate: string | null): AllocationResult["headline"] => {
    if (sooner != null && sooner > 0) {
      return { kind: "fi", label: `FI ${durationLabel(sooner)} sooner`, sublabel: fromDate && toDate ? `${fromDate} → ${toDate}` : "" };
    }
    if (chosenDate) return { kind: "fi", label: `FI ~${chosenDate}`, sublabel: "" };
    return { kind: "fi", label: "—", sublabel: "" };
  };

  if (choice === "mortgage") {
    recurringTitle = "Mortgage";
    rungs.push({
      key: "mortgage",
      title: "Mortgage",
      amount: rem,
      tag: { text: `${pct(mortgageRate)} · guaranteed`, cls: "guaranteed" },
      detail: {
        lines: [
          { label: "Extra at the mortgage", value: extraText },
          { label: "Interest saved (life of loan)", value: sim.interestSaved != null && sim.interestSaved > 0 ? money(sim.interestSaved) : "—" },
          { label: "Mortgage-free", value: payMortgageArm.mortgageFreeDate ?? "—" },
          { label: "FI reached", value: payMortgageArm.fiDate ?? "not in horizon" },
        ],
        why: monthsSooner != null && monthsSooner > 0
          ? `Paying the mortgage down reaches FI about ${durationLabel(monthsSooner)} sooner than investing the same money. Clearing it ~${payMortgageArm.mortgageFreeDate ?? "—"} frees the ${money(repaymentFI.freedPayment)}/mo repayment to invest years earlier — and it's a certain ${pct(mortgageRate)} vs an average ~${pct(nominalReturn)} with risk.`
          : `A certain ${pct(mortgageRate)} return that clears the loan ~${payMortgageArm.mortgageFreeDate ?? "—"} and frees the ${money(repaymentFI.freedPayment)}/mo repayment to invest later — at least as fast a route to FI as investing here.`,
      },
    });
    headline = fiHeadline(monthsSooner, investArm.fiDate, payMortgageArm.fiDate, payMortgageArm.fiDate);
    // Show investments as the not-chosen alternative at $0.
    rungs.push({
      key: "invest",
      title: "Investments",
      amount: 0,
      tag: { text: `~${pct(nominalReturn)} · risky`, cls: "risky" },
      detail: {
        lines: [{ label: "Routed here", value: money(0) }],
        why: `Investing this instead reaches FI ~${investArm.fiDate ?? "not in horizon"} — later than paying the mortgage down, so the spare goes to the loan. It'd take over once paying down stops being the faster route to FI.`,
      },
    });
  } else {
    recurringTitle = "Investments";
    rungs.push({
      key: "invest",
      title: "Investments",
      amount: rem,
      tag: { text: `~${pct(nominalReturn)} · risky`, cls: "risky" },
      detail: {
        lines: [
          { label: "Extra invested", value: extraText },
          { label: "FI reached", value: investArm.fiDate ?? "not in horizon" },
        ],
        why: monthsSooner != null && monthsSooner < 0
          ? `Investing the spare reaches FI about ${durationLabel(-monthsSooner)} sooner than putting it on the mortgage — the expected ~${pct(nominalReturn)} growth outpaces clearing a ${pct(mortgageRate)} loan here. Paying down still helps, just slower.`
          : `Expected ~${pct(nominalReturn)} growth (with risk) reaches FI at least as soon as paying down the ${pct(mortgageRate)} mortgage here.`,
      },
    });
    headline = fiHeadline(monthsSooner != null ? -monthsSooner : null, payMortgageArm.fiDate, investArm.fiDate, investArm.fiDate);
    rungs.push({
      key: "mortgage",
      title: "Mortgage",
      amount: 0,
      tag: { text: `${pct(mortgageRate)} · guaranteed`, cls: "guaranteed" },
      detail: {
        lines: [{ label: "Routed here", value: money(0) }],
        why: `Paying down reaches FI ~${payMortgageArm.fiDate ?? "not in horizon"} — slower than investing here. It still helps (lower spend at payoff); it just isn't the fastest lever right now.`,
      },
    });
  }

  const parts: string[] = [];
  const visaRung = rungs.find((x) => x.key === "debt");
  if (visaRung) parts.push(`clear the ${money(visaRung.amount)} Visa`);
  for (const rr of rungs.filter((x) => x.key === "reserve")) parts.push(`${money(rr.amount)} to ${rr.title}`);
  const revRung = rungs.find((x) => x.key === "revolving");
  if (revRung && revRung.amount > 0) parts.push(`${money(revRung.amount)} to ${revRung.title}`);
  const efRung = rungs.find((x) => x.key === "emergency");
  if (efRung && efRung.amount > 0) parts.push(`${money(efRung.amount)} to ${efRung.title}`);
  parts.push(`the rest at ${recurringTitle.toLowerCase()}`);
  const recommendation = capitalise(parts.join(" · ")) + ".";

  const mortgageVsInvest: AllocationFork = {
    routed: rem,
    choice,
    freedPayment: repaymentFI.freedPayment,
    monthsSooner,
    mortgageRate,
    nominalReturn,
    invest: { fiDate: investArm.fiDate, fiAge: investArm.fiAge, fiReached: investArm.fiReached },
    payMortgage: {
      fiDate: payMortgageArm.fiDate,
      fiAge: payMortgageArm.fiAge,
      fiReached: payMortgageArm.fiReached,
      mortgageFreeDate: payMortgageArm.mortgageFreeDate,
      interestSaved: sim.interestSaved,
    },
  };

  const result: AllocationResult = {
    surplus,
    lumpSum,
    total,
    rungs,
    recommendation,
    headline,
    recurringChoice: choice,
    mortgageVsInvest,
  };
  return result;
}
