import { describe, it, expect } from "vitest";
import { emergencyFundState, essentialMonthlySpend } from "@/lib/buffer/compute";

describe("essentialMonthlySpend", () => {
  it("scales trailing essential outflow to a month (outflow is negative)", () => {
    // $3,650 of essential spend over 365 days ≈ $304/mo.
    const txns = [{ amount: -3650 }];
    expect(essentialMonthlySpend(txns, 365)).toBeCloseTo((3650 * 365) / (365 * 12), 2);
  });
  it("nets refunds (inflows) against spend", () => {
    expect(essentialMonthlySpend([{ amount: -1200 }, { amount: 200 }], 365)).toBeCloseTo((1000 * 365) / (365 * 12), 2);
  });
  it("never returns negative, and is 0 for a non-positive window", () => {
    expect(essentialMonthlySpend([{ amount: 500 }], 365)).toBe(0); // net inflow → floored at 0
    expect(essentialMonthlySpend([{ amount: -500 }], 0)).toBe(0);
  });
});

describe("emergencyFundState", () => {
  const base = {
    configured: true,
    accountName: "Rainy day fund",
    balance: 5400,
    essentialMonthly: 3000,
    targetMonths: 3,
  };

  it("targets N months of essentials and reports the shortfall", () => {
    const s = emergencyFundState(base);
    expect(s.target).toBe(9000); // 3 × 3000
    expect(s.shortfall).toBe(3600); // 9000 − 5400
    expect(s.monthsCovered).toBeCloseTo(1.8, 5); // 5400 / 3000
    expect(s.pctFunded).toBeCloseTo(0.6, 5);
    expect(s.funded).toBe(false);
  });

  it("marks funded once the balance reaches the target, with no shortfall", () => {
    const s = emergencyFundState({ ...base, balance: 9500 });
    expect(s.funded).toBe(true);
    expect(s.shortfall).toBe(0);
    expect(s.pctFunded).toBeGreaterThan(1);
  });

  it("clamps negatives and handles a zero essential signal (no target, no divide-by-zero)", () => {
    const s = emergencyFundState({ ...base, balance: -50, essentialMonthly: 0 });
    expect(s.balance).toBe(0);
    expect(s.target).toBe(0);
    expect(s.shortfall).toBe(0);
    expect(s.monthsCovered).toBeNull();
    expect(s.pctFunded).toBeNull();
    expect(s.funded).toBe(false);
  });

  it("passes configured/accountName through (an unconfigured fund still sizes a would-be target)", () => {
    const s = emergencyFundState({ configured: false, accountName: null, balance: 0, essentialMonthly: 3000, targetMonths: 3 });
    expect(s.configured).toBe(false);
    expect(s.target).toBe(9000); // can prompt "a 3-month cushion would be $9,000"
    expect(s.shortfall).toBe(9000);
  });
});
