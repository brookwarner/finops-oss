import { describe, it, expect } from "vitest";
import { shapeIncomeHistory, bucketIncomeTxns, clampCycleLimit, type IncomeBucket, type IncomeBudgetRef } from "./history";
import type { Period } from "@/lib/budgets/period";

const cycles: Period[] = [
  { start: new Date(Date.UTC(2026, 4, 20)), end: new Date(Date.UTC(2026, 5, 20)) },
  { start: new Date(Date.UTC(2026, 3, 20)), end: new Date(Date.UTC(2026, 4, 20)) },
];
const budgets: IncomeBudgetRef[] = [
  { categoryId: "salary", name: "Salary", target: 10600 },
  { categoryId: "ece", name: "Partner ECE Income", target: 550 },
];

describe("shapeIncomeHistory", () => {
  it("pairs each source's actual against its plan per cycle, newest-first", () => {
    const buckets: IncomeBucket[] = [
      { categoryId: "salary", name: "Salary", cycleStart: "2026-05-20", actual: 9200 },
      { categoryId: "ece", name: "Partner ECE Income", cycleStart: "2026-05-20", actual: 550 },
      { categoryId: "salary", name: "Salary", cycleStart: "2026-04-20", actual: 10600 },
    ];
    const { cycles: out } = shapeIncomeHistory(buckets, budgets, cycles);
    expect(out).toHaveLength(2);
    expect(out[0].period_start).toBe("2026-05-20");
    expect(out[0].period_end).toBe("2026-06-20");
    expect(out[0].total).toBe(9750);
    expect(out[0].plannedTotal).toBe(11150);
    expect(out[0].sources.map((s) => s.categoryId)).toEqual(["salary", "ece"]);
    expect(out[0].sources[0]).toEqual({ categoryId: "salary", name: "Salary", actual: 9200, plan: 10600 });
    expect(out[1].sources.find((s) => s.categoryId === "ece")).toEqual({
      categoryId: "ece", name: "Partner ECE Income", actual: 0, plan: 550,
    });
  });

  it("lists an unbudgeted source present in txns with plan 0", () => {
    const buckets: IncomeBucket[] = [
      { categoryId: "biz", name: "Business Income", cycleStart: "2026-05-20", actual: 1200 },
    ];
    const { cycles: out } = shapeIncomeHistory(buckets, budgets, cycles);
    const biz = out[0].sources.find((s) => s.categoryId === "biz");
    expect(biz).toEqual({ categoryId: "biz", name: "Business Income", actual: 1200, plan: 0 });
    expect(out[0].plannedTotal).toBe(11150);
  });

  it("nets refunds/clawbacks within a cycle (buckets already signed-summed)", () => {
    const buckets: IncomeBucket[] = [
      { categoryId: "salary", name: "Salary", cycleStart: "2026-05-20", actual: 9000 },
    ];
    const { cycles: out } = shapeIncomeHistory(buckets, budgets, cycles);
    expect(out[0].sources[0].actual).toBe(9000);
  });

  it("returns no income txns -> cycles still rendered with plan + zero bars", () => {
    const { cycles: out } = shapeIncomeHistory([], budgets, cycles);
    expect(out).toHaveLength(2);
    expect(out[0].total).toBe(0);
    expect(out[0].plannedTotal).toBe(11150);
    expect(out[0].sources.every((s) => s.actual === 0)).toBe(true);
    expect(out[0].sources).toHaveLength(2);
  });

  it("empty cycles arg -> empty series", () => {
    expect(shapeIncomeHistory([], budgets, []).cycles).toEqual([]);
  });
});

describe("bucketIncomeTxns", () => {
  const cycles = [
    { start: new Date(Date.UTC(2026, 4, 20)), end: new Date(Date.UTC(2026, 5, 20)) },
    { start: new Date(Date.UTC(2026, 3, 20)), end: new Date(Date.UTC(2026, 4, 20)) },
  ];
  const nameById = new Map([["salary", "Salary"], ["ece", "Partner ECE Income"]]);

  it("buckets signed amounts by (category, containing cycle)", () => {
    const txns = [
      { category_id: "salary", amount: 2300, occurred_at: "2026-05-22T00:00:00Z" },
      { category_id: "salary", amount: 2300, occurred_at: "2026-05-29T00:00:00Z" },
      { category_id: "salary", amount: -300, occurred_at: "2026-05-30T00:00:00Z" },
      { category_id: "ece", amount: 550, occurred_at: "2026-04-25T00:00:00Z" },
      { category_id: "salary", amount: 9999, occurred_at: "2026-03-01T00:00:00Z" },
    ];
    const buckets = bucketIncomeTxns(txns, cycles, nameById);
    const salMay = buckets.find((b) => b.categoryId === "salary" && b.cycleStart === "2026-05-20");
    expect(salMay?.actual).toBe(4300);
    const eceApr = buckets.find((b) => b.categoryId === "ece" && b.cycleStart === "2026-04-20");
    expect(eceApr?.actual).toBe(550);
    expect(buckets.find((b) => b.cycleStart < "2026-04-20")).toBeUndefined();
  });
});

describe("clampCycleLimit", () => {
  it("defaults to 12 for undefined and NaN (malformed ?limit=abc)", () => {
    expect(clampCycleLimit(undefined)).toBe(12);
    expect(clampCycleLimit(Number("abc"))).toBe(12); // NaN -> default, not 0 cycles
  });
  it("clamps to [1, 36]", () => {
    expect(clampCycleLimit(0)).toBe(1);
    expect(clampCycleLimit(100)).toBe(36);
    expect(clampCycleLimit(6)).toBe(6);
  });
});
