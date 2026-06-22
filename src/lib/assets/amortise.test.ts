import { describe, it, expect } from "vitest";
import { projectBalance } from "./amortise";

const pay = (amount: number, date: string) => ({ amount, date });
const ANCHOR = "2026-01-01";

describe("projectBalance", () => {
  it("0% rate: full payment is principal (dates irrelevant)", () => {
    const r = projectBalance({
      anchorBalance: 1000, annualRate: 0, anchorDate: ANCHOR,
      payments: [pay(-250, "2026-01-15"), pay(-250, "2026-02-15"), pay(-250, "2026-03-15")],
    });
    expect(r.balance).toBe(250);
    expect(r.paidOff).toBe(false);
    expect(r.totalInterest).toBe(0);
  });

  it("Actual/365: interest = balance × rate × days/365", () => {
    // 36.5% p.a., 10 days from anchor → 1000 × 0.365 × 10/365 = 10.00 interest.
    const r = projectBalance({
      anchorBalance: 1000, annualRate: 36.5, anchorDate: ANCHOR,
      payments: [pay(-100, "2026-01-11")],
    });
    expect(r.totalInterest).toBe(10);
    expect(r.balance).toBe(910); // 1000 − (100 − 10)
  });

  it("interest scales with elapsed days: fortnightly accrues less per step than the gap implies", () => {
    // 36.5% p.a.; two payments 14 days apart.
    const r = projectBalance({
      anchorBalance: 1000, annualRate: 36.5, anchorDate: ANCHOR,
      payments: [pay(-100, "2026-01-15"), pay(-100, "2026-01-29")],
    });
    // p1: 14d → 1000×0.365×14/365 = 14.00 int, bal 914.
    // p2: 14d → 914×0.365×14/365 = 12.796 int, bal 826.80.
    expect(r.totalInterest).toBeCloseTo(26.8, 1);
    expect(r.balance).toBeCloseTo(826.8, 1);
  });

  it("same-day payment accrues 0 interest (0 days elapsed)", () => {
    const r = projectBalance({
      anchorBalance: 1000, annualRate: 36.5, anchorDate: ANCHOR,
      payments: [pay(-100, "2026-01-11"), pay(-100, "2026-01-11")],
    });
    // p1: 10d → 10 int, bal 910. p2: 0d → 0 int, bal 810.
    expect(r.totalInterest).toBe(10);
    expect(r.balance).toBe(810);
  });

  it("clamps to zero and reports paidOff", () => {
    const r = projectBalance({
      anchorBalance: 200, annualRate: 0, anchorDate: ANCHOR, payments: [pay(-250, "2026-01-15")],
    });
    expect(r.balance).toBe(0);
    expect(r.paidOff).toBe(true);
  });

  it("a refund (positive amount) restores balance", () => {
    const r = projectBalance({
      anchorBalance: 500, annualRate: 0, anchorDate: ANCHOR,
      payments: [pay(-250, "2026-01-15"), pay(100, "2026-02-15")],
    });
    expect(r.balance).toBe(350);
  });

  it("no payments leaves the anchor balance", () => {
    const r = projectBalance({ anchorBalance: 4500, annualRate: 0, anchorDate: ANCHOR, payments: [] });
    expect(r.balance).toBe(4500);
    expect(r.paidOff).toBe(false);
  });

  it("payment below accrued interest grows the balance", () => {
    // 120% p.a., 30 days → 1000×1.2×30/365 = 98.63 int; pay 50 → balance grows.
    const r = projectBalance({
      anchorBalance: 1000, annualRate: 120, anchorDate: ANCHOR, payments: [pay(-50, "2026-01-31")],
    });
    expect(r.balance).toBeCloseTo(1048.63, 2);
    expect(r.paidOff).toBe(false);
  });
});
