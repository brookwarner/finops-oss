import { describe, it, expect } from "vitest";
import { projectFI, projectVarying } from "@/lib/fi/compute";
import {
  simulateRepaymentFI,
  freedMonthlyPayment,
  type RepaymentFIBase,
} from "@/lib/fi/repayment";
import type { ScenarioPartInput } from "@/lib/mortgage/scenario";

const NOW = new Date(Date.UTC(2026, 5, 21)); // 21 Jun 2026
const DOB = new Date(Date.UTC(1986, 8, 10)); // 10 Sep 1986

const part = (over: Partial<ScenarioPartInput> = {}): ScenarioPartInput => ({
  balance: 100_000,
  monthlyPayment: 1_000,
  annualRate: 5,
  refixMonths: null,
  ...over,
});

const base = (over: Partial<RepaymentFIBase> = {}): RepaymentFIBase => ({
  startAssets: 10_000,
  baseContribution: 0,
  realAnnualReturn: 0.05,
  fiNumber: 300_000,
  mortgageParts: [part()],
  now: NOW,
  dob: DOB,
  ...over,
});

describe("projectVarying / projectFI refactor", () => {
  it("projectFI is the constant-contribution case of projectVarying", () => {
    const args = {
      startAssets: 10_000,
      realAnnualReturn: 0.05,
      fiNumber: 100_000,
      now: NOW,
      dob: DOB,
    };
    const flat = projectFI({ ...args, monthlyContribution: 500 });
    const varying = projectVarying({ ...args, contributionAt: () => 500 });
    expect(varying).toEqual(flat);
    expect(flat.reached).toBe(true);
    expect(flat.months).toBeGreaterThan(0);
  });

  it("a mid-stream step-up reaches FI no later than the lower flat rate", () => {
    const args = { startAssets: 0, realAnnualReturn: 0.05, fiNumber: 200_000, now: NOW, dob: DOB };
    const low = projectFI({ ...args, monthlyContribution: 500 });
    const stepped = projectVarying({
      ...args,
      contributionAt: (m) => (m >= 60 ? 2_000 : 500),
    });
    // Same first 60 months, then a bigger contribution → reaches sooner.
    expect(stepped.months!).toBeLessThan(low.months!);
  });
});

describe("freedMonthlyPayment", () => {
  it("sums the scheduled repayments across tranches", () => {
    expect(freedMonthlyPayment([part({ monthlyPayment: 1_000 }), part({ monthlyPayment: 1_200 })])).toBe(2_200);
  });
  it("ignores negative/zero payments", () => {
    expect(freedMonthlyPayment([part({ monthlyPayment: 1_000 }), part({ monthlyPayment: -50 })])).toBe(1_000);
  });
});

describe("simulateRepaymentFI", () => {
  it("with no extra and no lump, the two arms are identical (tie)", () => {
    const r = simulateRepaymentFI(base(), { extraPerMonth: 0, lumpSum: 0 });
    expect(r.monthsSooner).toBe(0);
    expect(r.verdict).toBe("tie");
    expect(r.payMortgageArm.fiMonths).toBe(r.investArm.fiMonths);
    expect(r.payMortgageArm.mortgageFreeMonths).toBe(r.investArm.mortgageFreeMonths);
  });

  it("extra repayment clears the mortgage strictly sooner than investing it", () => {
    const r = simulateRepaymentFI(base(), { extraPerMonth: 1_000, lumpSum: 0 });
    expect(r.payMortgageArm.mortgageFreeMonths!).toBeLessThan(r.investArm.mortgageFreeMonths!);
    // The invest arm's mortgage runs to the unchanged schedule.
    const sched = simulateRepaymentFI(base(), { extraPerMonth: 0, lumpSum: 0 });
    expect(r.investArm.mortgageFreeMonths).toBe(sched.payMortgageArm.mortgageFreeMonths);
  });

  it("exposes the freed payment and lifetime interest saved", () => {
    const r = simulateRepaymentFI(base(), { extraPerMonth: 1_000, lumpSum: 0 });
    expect(r.freedPayment).toBe(1_000);
    expect(r.mortgage.interestSaved!).toBeGreaterThan(0);
  });

  it("verdict is consistent with the months-sooner sign", () => {
    for (const extra of [0, 250, 500, 1_000, 3_000]) {
      const r = simulateRepaymentFI(base(), { extraPerMonth: extra, lumpSum: 0 });
      if (r.monthsSooner == null) continue;
      if (r.monthsSooner > 0) expect(r.verdict).toBe("pay_mortgage");
      else if (r.monthsSooner < 0) expect(r.verdict).toBe("invest");
      else expect(r.verdict).toBe("tie");
    }
  });

  it("when both arms eventually deploy the same money, paying the mortgage down front-loads the freed payment and reaches FI no later", () => {
    // High freed payment + reachable FI number: clearing sooner pulls FI forward.
    const r = simulateRepaymentFI(
      base({ baseContribution: 0, fiNumber: 300_000, mortgageParts: [part({ balance: 50_000, monthlyPayment: 3_000 })] }),
      { extraPerMonth: 3_000, lumpSum: 0 },
    );
    expect(r.payMortgageArm.fiReached).toBe(true);
    expect(r.investArm.fiReached).toBe(true);
    expect(r.payMortgageArm.fiMonths!).toBeLessThanOrEqual(r.investArm.fiMonths!);
    expect(r.verdict === "pay_mortgage" || r.verdict === "tie").toBe(true);
  });

  it("a lump sum invested raises start assets; routed to the mortgage it clears sooner", () => {
    const lump = simulateRepaymentFI(base(), { extraPerMonth: 0, lumpSum: 20_000 });
    const noLump = simulateRepaymentFI(base(), { extraPerMonth: 0, lumpSum: 0 });
    // Lump on the mortgage → pay arm clears sooner than with no lump.
    expect(lump.payMortgageArm.mortgageFreeMonths!).toBeLessThan(noLump.payMortgageArm.mortgageFreeMonths!);
    // Lump invested → invest arm reaches FI no later than with no lump.
    expect(lump.investArm.fiMonths!).toBeLessThanOrEqual(noLump.investArm.fiMonths!);
  });

  it("coerces serialised (string) dates from the RSC boundary", () => {
    const r = simulateRepaymentFI(
      base({ now: NOW.toISOString(), dob: DOB.toISOString() }),
      { extraPerMonth: 500, lumpSum: 0 },
    );
    expect(r.investArm.mortgageFreeDate).toMatch(/^\d{4}-\d{2}$/);
  });
});
