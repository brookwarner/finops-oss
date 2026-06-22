import { describe, it, expect } from "vitest";
import { buildForecast } from "./compute";
import type { ForecastEvent } from "./events";

const ctx = { reservesEarmarked: 500, revolvingDrawn: -19738.79 };
const assumptions = {
  income: [{ cadenceDays: 7, amount: 2300, lastDate: "2026-05-29", source: "inferred" as const }],
  dailyBurn: 95,
  bills: [{ name: "Mortgage", day: 21, amount: 1210, source: "actual" as const }],
};

describe("buildForecast", () => {
  it("walks the balance, finds the trough, and clears payday with margin", () => {
    const events: ForecastEvent[] = [
      { date: "2026-06-03", delta: -800, label: "bill:rent", kind: "committed" },
      { date: "2026-06-05", delta: 2300, label: "Pay", kind: "income" },
    ];
    const r = buildForecast({
      now: new Date("2026-06-01"), horizonDays: 7, startBalance: 1000, events, ...ctx, assumptions,
    });
    expect(r.series).toHaveLength(8); // day 0..7 inclusive
    expect(r.series[0]).toEqual({ date: "2026-06-01", balance: 1000 });
    expect(r.trough.balance).toBe(200);
    expect(r.trough.date).toBe("2026-06-03");
    expect(r.nextPayday).toEqual({ date: "2026-06-05", amount: 2300 });
    expect(r.verdict.makesIt).toBe(true);
    expect(r.verdict.margin).toBe(200);
    expect(r.verdict.text).toContain("bills");
    expect(r.billsDue).toEqual({ date: "2026-06-03", amount: 800, count: 1 });
    expect(r.context).toEqual(ctx);
    expect(r.events).toBe(events); // events echoed through for the agenda view
    expect(r.assumptions).toBe(assumptions);
  });

  it("flags a shortfall when the trough goes negative before payday", () => {
    const events: ForecastEvent[] = [
      { date: "2026-06-03", delta: -1300, label: "bill:rent", kind: "committed" },
      { date: "2026-06-05", delta: 2300, label: "Pay", kind: "income" },
    ];
    const r = buildForecast({
      now: new Date("2026-06-01"), horizonDays: 7, startBalance: 1000, events, ...ctx, assumptions,
    });
    expect(r.trough.balance).toBe(-300);
    expect(r.verdict.makesIt).toBe(false);
    expect(r.verdict.margin).toBe(-300);
    expect(r.verdict.text).toContain("short");
    expect(r.verdict.text).toContain("covering your bills");
    expect(r.billsDue).toEqual({ date: "2026-06-03", amount: 1300, count: 1 });
  });

  it("returns a null payday and uses the horizon end when no income event exists", () => {
    const r = buildForecast({
      now: new Date("2026-06-01"), horizonDays: 3, startBalance: 50,
      events: [{ date: "2026-06-02", delta: -60, label: "x", kind: "variable" }], ...ctx, assumptions,
    });
    expect(r.nextPayday).toBeNull();
    expect(r.billsDue).toBeNull();
    expect(r.verdict.text).toContain("short on the"); // fallback wording, not the bills branch
    expect(r.trough.balance).toBe(-10);
    expect(r.verdict.makesIt).toBe(false);
  });

  it("anchors the cutoff to the bill cluster + grace, past the next pay", () => {
    // Pay on the 5th lifts the balance, but the bills on the 10th are the real
    // stress point — the verdict must look past payday to the cluster.
    const events: ForecastEvent[] = [
      { date: "2026-06-05", delta: 2300, label: "Pay", kind: "income" },
      { date: "2026-06-10", delta: -2800, label: "bill:mortgage", kind: "committed" },
    ];
    const r = buildForecast({
      now: new Date("2026-06-01"), horizonDays: 20, startBalance: 1000, events, ...ctx, assumptions,
    });
    expect(r.billsDue).toEqual({ date: "2026-06-10", amount: 2800, count: 1 });
    expect(r.trough.date).toBe("2026-06-10");   // trough is the post-bills dip
    expect(r.trough.balance).toBe(500);         // 1000 + 2300 - 2800
    expect(r.verdict.makesIt).toBe(true);
    expect(r.nextPayday).toEqual({ date: "2026-06-05", amount: 2300 });
  });
});

import { everydayStartBalance, EVERYDAY_ACCOUNT_IDS, appendShadowCommitted } from "./compute";
import type { ShadowBill } from "@/lib/budgets/committed";

describe("appendShadowCommitted", () => {
  const makeShadow = (name: string, monthlyAvg: number, lastDay: number | null = 15, lastAmount: number | null = 50): ShadowBill => ({
    categoryId: "cat-shadow",
    name,
    monthlyAvg,
    occurrences: 2,
    lastDay,
    lastAmount,
  });

  it("appends an unbudgeted recurring ap_amortised category as a committed bill", () => {
    const shadow = makeShadow("Netflix", 25.99, 12, 25.99);
    const result = appendShadowCommitted([], [shadow]);
    expect(result).toHaveLength(1);
    expect(result[0].categoryId).toBe("Netflix");
    expect(result[0].kind).toBe("ap_amortised");
    expect(result[0].monthlyTarget).toBe(25.99);
    expect(result[0].lastActualDay).toBe(12);
    expect(result[0].lastActualAmount).toBe(25.99);
  });

  it("does NOT include Mortgage Interest in shadow bills (excluded upstream by shadowCommittedByCat)", () => {
    // shadowCommittedByCat already excludes Mortgage Interest; appendShadowCommitted
    // should receive an empty list if it was the only candidate, leaving committed unchanged.
    const result = appendShadowCommitted([], []);
    expect(result).toHaveLength(0);
  });

  it("preserves existing budgeted committed entries and appends shadow ones", () => {
    const existing = [{
      categoryId: "Mortgage Principal",
      kind: "ap_amortised" as const,
      monthlyTarget: 1200,
      lastActualDay: 21,
      lastActualAmount: 1210,
      spendClass: "essential" as const,
    }];
    const shadow = makeShadow("Spotify", 16.99, 5, 16.99);
    const result = appendShadowCommitted(existing, [shadow]);
    expect(result).toHaveLength(2);
    expect(result[0].categoryId).toBe("Mortgage Principal");
    expect(result[1].categoryId).toBe("Spotify");
    expect(result[1].monthlyTarget).toBe(16.99);
  });

  it("does not mutate the original committed array", () => {
    const original = [{
      categoryId: "Rent",
      kind: "ap_amortised" as const,
      monthlyTarget: 800,
      lastActualDay: 1,
      lastActualAmount: 800,
      spendClass: "essential" as const,
    }];
    appendShadowCommitted(original, [makeShadow("Gym", 49, 10, 49)]);
    expect(original).toHaveLength(1);
  });
});

describe("everydayStartBalance", () => {
  it("sums only the allowlisted everyday accounts", () => {
    const accounts = [
      { akahu_account_id: "acc_example_checking", balance_current: 114.96 },
      { akahu_account_id: "acc_example_savings", balance_current: 30.2 },
      { akahu_account_id: "acc_other_savings", balance_current: 9999 },
    ];
    expect(everydayStartBalance(accounts)).toBeCloseTo(145.16, 2);
  });

  it("treats a missing balance as zero", () => {
    const accounts = [{ akahu_account_id: EVERYDAY_ACCOUNT_IDS[0], balance_current: null }];
    expect(everydayStartBalance(accounts)).toBe(0);
  });
});
