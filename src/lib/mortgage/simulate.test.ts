import { describe, it, expect } from "vitest";
import { simulateTranche, monthsToYM } from "./simulate";

describe("simulateTranche", () => {
  it("amortises a standard loan to a finite month count", () => {
    // $100k at 6% p.a. (0.5%/mo), $2000/mo → ~58 months, matching the closed form.
    const r = simulateTranche({ balance: 100_000, monthlyPayment: 2000, annualRate: 6 });
    expect(r.monthsRemaining).toBe(58);
    expect(r.totalInterest).toBeGreaterThan(0);
  });

  it("never clears when the payment can't cover interest", () => {
    const r = simulateTranche({ balance: 100_000, monthlyPayment: 400, annualRate: 6 });
    expect(r.monthsRemaining).toBeNull();
  });

  it("clears faster with an extra monthly payment", () => {
    const base = simulateTranche({ balance: 100_000, monthlyPayment: 2000, annualRate: 6 });
    const extra = simulateTranche({ balance: 100_000, monthlyPayment: 2000, annualRate: 6, extraPerMonth: 500 });
    expect(extra.monthsRemaining!).toBeLessThan(base.monthsRemaining!);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
  });

  it("a lump sum reduces both the term and total interest", () => {
    const base = simulateTranche({ balance: 100_000, monthlyPayment: 2000, annualRate: 6 });
    const lump = simulateTranche({ balance: 100_000, monthlyPayment: 2000, annualRate: 6, lumpSum: 20_000 });
    expect(lump.monthsRemaining!).toBeLessThan(base.monthsRemaining!);
    expect(lump.totalInterest).toBeLessThan(base.totalInterest);
  });

  it("applies a refix rate from the given month", () => {
    const stay = simulateTranche({ balance: 100_000, monthlyPayment: 2000, annualRate: 5 });
    const refixUp = simulateTranche({
      balance: 100_000,
      monthlyPayment: 2000,
      annualRate: 5,
      refixAfterMonths: 12,
      refixAnnualRate: 8,
    });
    // Refixing UP to 8% after a year costs more interest and takes longer.
    expect(refixUp.totalInterest).toBeGreaterThan(stay.totalInterest);
    expect(refixUp.monthsRemaining!).toBeGreaterThanOrEqual(stay.monthsRemaining!);
  });

  it("treats a paid-off balance as zero months", () => {
    expect(simulateTranche({ balance: 5000, monthlyPayment: 100, annualRate: 5, lumpSum: 5000 }).monthsRemaining).toBe(0);
  });
});

describe("monthsToYM", () => {
  it("adds months across a year boundary", () => {
    expect(monthsToYM(new Date("2026-06-15T00:00:00Z"), 8)).toBe("2027-02");
  });
});
