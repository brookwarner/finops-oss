// src/lib/allocation/compute.test.ts
import { describe, it, expect } from "vitest";
import { computeAllocation, avgMortgageRate, type AllocationInput } from "./compute";
import { simulateRepaymentFI } from "@/lib/fi/repayment";

const DOB = new Date(Date.UTC(1986, 8, 10));

// Baseline whose mortgage-vs-invest decision resolves to "mortgage" under the
// repayment→FI simulation (low existing contribution + a high-rate loop whose
// freed payment, redirected at payoff, beats investing the spare). Keeps the
// debt/reserve cascade assertions free of the choice logic.
function baseInput(over: Partial<AllocationInput> = {}): AllocationInput {
  return {
    surplusPerMonth: 500,
    lumpSum: 0,
    visa: null,
    revolvingLoan: null,
    reserves: [],
    emergencyFund: null,
    mortgageParts: [
      { balance: 200_000, monthlyPayment: 1200, annualRate: 6.1, refixMonths: 12 },
    ],
    fi: {
      vsTargetYears: -2, // ahead of target → on track
      monthlyContribution: 1000,
      startAssets: 120_000,
      fiNumber: 1_500_000,
      realReturn: 0.035,
      dob: DOB,
    },
    assumedInflation: 0.035,
    now: new Date(Date.UTC(2026, 5, 8)),
    ...over,
  };
}

describe("computeAllocation — debt + reserves", () => {
  it("clears the Visa first, before any other rung", () => {
    // Pool (1000) comfortably exceeds the balance so the full Visa clears.
    const r = computeAllocation(baseInput({ surplusPerMonth: 1000, visa: { balance: 762, apr: 0.1995 } }));
    expect(r.rungs[0].key).toBe("debt");
    expect(r.rungs[0].amount).toBe(762);
    expect(r.rungs[0].tag.cls).toBe("guaranteed");
  });

  it("omits the debt rung when there is no Visa balance", () => {
    const r = computeAllocation(baseInput({ visa: null }));
    expect(r.rungs.find((x) => x.key === "debt")).toBeUndefined();
  });

  it("funds behind reserves largest-shortfall-first, capped at the shortfall", () => {
    const r = computeAllocation(
      baseInput({
        surplusPerMonth: 500,
        reserves: [
          { name: "Car", shortfall: 400 },
          { name: "Insurance", shortfall: 90 },
        ],
      }),
    );
    const reserves = r.rungs.filter((x) => x.key === "reserve");
    expect(reserves.map((x) => x.title)).toEqual(["Car", "Insurance"]);
    expect(reserves[0].amount).toBe(400);
    expect(reserves[1].amount).toBe(90);
  });

  it("funds the revolving loan after reserves but before the mortgage", () => {
    const r = computeAllocation(
      baseInput({
        surplusPerMonth: 2000,
        reserves: [{ name: "Car", shortfall: 300 }],
        revolvingLoan: { name: "Choices", balance: 20_138, rate: 0.0569 },
      }),
    );
    const keys = r.rungs.map((x) => x.key);
    // reserve precedes revolving precedes mortgage in the cascade
    expect(keys.indexOf("reserve")).toBeLessThan(keys.indexOf("revolving"));
    expect(keys.indexOf("revolving")).toBeLessThan(keys.indexOf("mortgage"));
    const rev = r.rungs.find((x) => x.key === "revolving")!;
    // pool 2000 − 300 reserve = 1700 to the loan (capped below its 20,138 balance)
    expect(rev.amount).toBe(1700);
    expect(rev.tag.cls).toBe("guaranteed");
    expect(rev.detail.lines.find((l) => l.label === "Still owing after")!.value).toContain("18,438");
    expect(r.rungs.find((x) => x.key === "mortgage")!.amount).toBe(0); // pool exhausted
    expect(r.recommendation).toContain("Choices");
  });

  it("caps the revolving rung at its balance and passes the rest down", () => {
    const r = computeAllocation(
      baseInput({ surplusPerMonth: 5000, revolvingLoan: { name: "Choices", balance: 1200, rate: 0.0569 } }),
    );
    const rev = r.rungs.find((x) => x.key === "revolving")!;
    expect(rev.amount).toBe(1200); // capped at balance
    // Remainder flows past the capped revolving rung to the recurring destination
    // (mortgage or investments, whichever the simulation picks at this surplus).
    expect(r.rungs.find((x) => x.key === r.recurringChoice)!.amount).toBe(3800);
  });

  it("omits the revolving rung when nothing is owed", () => {
    expect(computeAllocation(baseInput({ revolvingLoan: null })).rungs.find((x) => x.key === "revolving")).toBeUndefined();
    expect(
      computeAllocation(baseInput({ revolvingLoan: { name: "Choices", balance: 0, rate: 0.0569 } })).rungs.find(
        (x) => x.key === "revolving",
      ),
    ).toBeUndefined();
  });

  it("funds the emergency fund after the revolving loan, before the mortgage/invest fork, capped at the shortfall", () => {
    const r = computeAllocation(
      baseInput({
        surplusPerMonth: 2000,
        revolvingLoan: { name: "Choices", balance: 300, rate: 0.0569 },
        emergencyFund: { name: "Rainy day fund", shortfall: 1200, targetMonths: 3, monthsCovered: 1.8 },
      }),
    );
    const keys = r.rungs.filter((x) => x.amount > 0).map((x) => x.key);
    // Only the chosen recurring rung (mortgage XOR invest) is funded; emergency
    // sits after revolving and before that fork.
    expect(keys.indexOf("revolving")).toBeLessThan(keys.indexOf("emergency"));
    const forkIdx = keys.indexOf(r.recurringChoice as "mortgage" | "invest");
    expect(keys.indexOf("emergency")).toBeLessThan(forkIdx);
    const ef = r.rungs.find((x) => x.key === "emergency")!;
    // pool 2000 − 300 revolving = 1700, capped at the 1200 shortfall
    expect(ef.amount).toBe(1200);
    expect(ef.tag.cls).toBe("need");
    expect(r.recommendation).toContain("Rainy day fund");
  });

  it("omits the emergency rung when funded or undesignated", () => {
    expect(
      computeAllocation(baseInput({ emergencyFund: null })).rungs.find((x) => x.key === "emergency"),
    ).toBeUndefined();
    expect(
      computeAllocation(
        baseInput({ emergencyFund: { name: "EF", shortfall: 0, targetMonths: 3, monthsCovered: 3.2 } }),
      ).rungs.find((x) => x.key === "emergency"),
    ).toBeUndefined();
  });

  it("never allocates more than the pool (conservation)", () => {
    const r = computeAllocation(
      baseInput({ surplusPerMonth: 300, visa: { balance: 762, apr: 0.1995 } }),
    );
    const sum = r.rungs.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBeCloseTo(300, 2);
    expect(r.rungs[0].amount).toBe(300); // whole pool to the Visa, still owing after
  });
});

describe("computeAllocation — mortgage vs invest", () => {
  it("routes the remainder to the mortgage when paying down reaches FI sooner", () => {
    const r = computeAllocation(baseInput());
    expect(r.recurringChoice).toBe("mortgage");
    const m = r.rungs.find((x) => x.key === "mortgage")!;
    expect(m.amount).toBeGreaterThan(0);
    // The headline is always the FI head-to-head now (not the mortgage-free date).
    expect(r.headline.kind).toBe("fi");
    expect(r.headline.label).toContain("FI");
    // mortgage rung carries both a payoff line and the FI-reached line
    expect(m.detail.lines.some((l) => l.label === "Mortgage-free")).toBe(true);
    expect(m.detail.lines.some((l) => l.label === "FI reached")).toBe(true);
  });

  it("routes to investments when investing the spare reaches FI sooner", () => {
    // A large existing contribution makes the marginal spare worth more compounding
    // for decades than the freed-payment-redirect head start from paying down.
    const r = computeAllocation(baseInput({ fi: { ...baseInput().fi, monthlyContribution: 3000 } }));
    expect(r.recurringChoice).toBe("invest");
    expect(r.headline.kind).toBe("fi");
    expect(r.rungs.find((x) => x.key === "invest")!.amount).toBeGreaterThan(0);
    expect(r.rungs.find((x) => x.key === "mortgage")!.amount).toBe(0);
  });

  it("exposes the head-to-head fork (both arms' FI outcomes) behind the final rung", () => {
    const r = computeAllocation(baseInput());
    const f = r.mortgageVsInvest;
    expect(f.choice).toBe(r.recurringChoice); // fork agrees with the chosen rung
    expect(f.routed).toBe(r.rungs.find((x) => x.key === r.recurringChoice)!.amount);
    expect(f.freedPayment).toBeGreaterThan(0); // scheduled P&I that redirects at payoff
    // Both sides carry an FI outcome so a surface can show "invest → X | mortgage → Y".
    expect(f.invest.fiDate).toMatch(/^\d{4}-\d{2}$/);
    expect(f.payMortgage.fiDate).toMatch(/^\d{4}-\d{2}$/);
    expect(f.payMortgage.mortgageFreeDate).toMatch(/^\d{4}-\d{2}$/);
    // Chosen by FI: monthsSooner sign lines up with the choice.
    if (f.monthsSooner != null && f.monthsSooner !== 0) {
      expect(f.choice).toBe(f.monthsSooner > 0 ? "mortgage" : "invest");
    }
  });

  it("the cascade choice always matches the repayment→FI simulation verdict", () => {
    // The whole point of the integration: the rung decision IS the simulation,
    // not a proxy. Check it across a sweep of contribution levels.
    for (const monthlyContribution of [0, 500, 1000, 3000, 6000]) {
      const input = baseInput({ fi: { ...baseInput().fi, monthlyContribution } });
      const sim = simulateRepaymentFI(
        {
          startAssets: input.fi.startAssets,
          baseContribution: input.fi.monthlyContribution,
          realAnnualReturn: input.fi.realReturn,
          fiNumber: input.fi.fiNumber,
          mortgageParts: input.mortgageParts,
          now: input.now,
          dob: input.fi.dob,
        },
        { extraPerMonth: input.surplusPerMonth, lumpSum: 0 },
      );
      const expected = sim.verdict === "invest" ? "invest" : "mortgage";
      expect(computeAllocation(input).recurringChoice).toBe(expected);
    }
  });

  it("computes the mortgage impact from steady-state surplus, not this cycle", () => {
    // With a Visa eating this cycle, the mortgage rung amount is small, but the
    // impact (months saved) is driven by the full $500/mo steady state.
    const r = computeAllocation(baseInput({ visa: { balance: 762, apr: 0.1995 } }));
    const m = r.rungs.find((x) => x.key === "mortgage")!;
    const extra = m.detail.lines.find((l) => l.label === "Extra at the mortgage")!;
    expect(extra.value).toContain("500"); // steady-state monthly, not the cycle leftover
  });

  it("conserves the pool across all rungs including the recurring one", () => {
    const r = computeAllocation(baseInput({ surplusPerMonth: 500, visa: { balance: 100, apr: 0.1995 }, reserves: [{ name: "Car", shortfall: 80 }] }));
    const sum = r.rungs.reduce((s, x) => s + x.amount, 0);
    expect(sum).toBeCloseTo(500, 2);
  });

  it("builds a one-sentence recommendation naming the rungs", () => {
    const r = computeAllocation(baseInput({ visa: { balance: 762, apr: 0.1995 } }));
    expect(r.recommendation).toContain("Visa");
    expect(r.recommendation.toLowerCase()).toContain("mortgage");
  });

  it("names behind reserves in the recommendation", () => {
    const r = computeAllocation(baseInput({ reserves: [{ name: "Car rego", shortfall: 120 }] }));
    expect(r.recommendation).toContain("Car rego");
  });
});

describe("avgMortgageRate", () => {
  it("balance-weights the rate across tranches and skips cleared ones", () => {
    const rate = avgMortgageRate([
      { balance: 300_000, monthlyPayment: 1500, annualRate: 6.0, refixMonths: 12 },
      { balance: 100_000, monthlyPayment: 600, annualRate: 7.0, refixMonths: 6 },
      { balance: 0, monthlyPayment: 0, annualRate: 99, refixMonths: null }, // cleared → ignored
    ]);
    // (300k·6 + 100k·7) / 400k = 6.25
    expect(rate).toBeCloseTo(6.25, 4);
  });

  it("returns 0 when there is no outstanding balance", () => {
    expect(avgMortgageRate([{ balance: 0, monthlyPayment: 0, annualRate: 6, refixMonths: null }])).toBe(0);
  });
});

describe("computeAllocation — edges", () => {
  it("returns no rungs and a 'nothing to allocate' state when surplus and lump are zero", () => {
    const r = computeAllocation(baseInput({ surplusPerMonth: 0, lumpSum: 0 }));
    expect(r.total).toBe(0);
    expect(r.rungs.filter((x) => x.amount > 0)).toHaveLength(0);
  });

  it("handles a lump-only input (no monthly surplus)", () => {
    const r = computeAllocation(baseInput({ surplusPerMonth: 0, lumpSum: 5000, visa: { balance: 762, apr: 0.1995 } }));
    expect(r.rungs[0].key).toBe("debt");
    expect(r.rungs[0].amount).toBe(762);
    expect(r.total).toBe(5000);
  });

  it("omits reserve rungs when nothing is behind", () => {
    const r = computeAllocation(baseInput({ reserves: [{ name: "Car", shortfall: 0 }] }));
    expect(r.rungs.find((x) => x.key === "reserve")).toBeUndefined();
  });

  it("shows the mortgage rung even when the whole pool is eaten by backlog", () => {
    const r = computeAllocation(baseInput({ surplusPerMonth: 100, visa: { balance: 5000, apr: 0.1995 } }));
    const m = r.rungs.find((x) => x.key === "mortgage")!;
    expect(m.amount).toBe(0); // nothing left this cycle…
    expect(m.detail.lines.find((l) => l.label === "Extra at the mortgage")!.value).toContain("100"); // …but steady-state impact still shown
  });
});
