import { describe, it, expect } from "vitest";
import { lastNCycles } from "./snapshot";

describe("lastNCycles", () => {
  it("returns n cycles, most-recent first, 20th->20th", () => {
    // 2026-06-05 is before the 20th -> current cycle is 2026-05-20 -> 2026-06-20
    const cycles = lastNCycles(new Date(2026, 5, 5), 3);
    expect(cycles).toHaveLength(3);
    expect(cycles[0].start.getFullYear()).toBe(2026);
    expect(cycles[0].start.getMonth()).toBe(4); // May (0-indexed)
    expect(cycles[0].start.getDate()).toBe(20);
    expect(cycles[0].end.getMonth()).toBe(5);   // June
    // immediately-preceding cycle
    expect(cycles[1].start.getMonth()).toBe(3); // April
    expect(cycles[1].end.getMonth()).toBe(4);   // May
  });

  it("wraps across the year boundary", () => {
    // 2026-01-10 is before the 20th -> current cycle is 2025-12-20 -> 2026-01-20
    const cycles = lastNCycles(new Date(2026, 0, 10), 2);
    expect(cycles[0].start.getFullYear()).toBe(2025);
    expect(cycles[0].start.getMonth()).toBe(11); // December
    expect(cycles[1].start.getFullYear()).toBe(2025);
    expect(cycles[1].start.getMonth()).toBe(10); // November
  });

  it("anchors to the current cycle on/after the 20th", () => {
    // 2026-06-25 is on/after the 20th -> current cycle is 2026-06-20 -> 2026-07-20
    const cycles = lastNCycles(new Date(2026, 5, 25), 1);
    expect(cycles[0].start.getMonth()).toBe(5); // June
    expect(cycles[0].end.getMonth()).toBe(6);   // July
  });
});

import { snapshotRecordsFromResult } from "./snapshot";
import type { BudgetComputeResult } from "./compute";

function fakeResult(): BudgetComputeResult {
  return {
    period: { start: "2026-05-20", end: "2026-06-20", dayOfPeriod: 10, periodLength: 31, daysLeft: 21 },
    rows: [
      { budgetId: "b1", categoryId: "c1", category: "Groceries", group: "Food", kind: "monthly_cap",
        target: 1200, spent: 1040, reimbursed: 0, netSpent: 1040, effectiveSpend: 1040,
        pct: 87, remaining: 160, status: "warning", projected: 1300, priorSpend: 1100,
        reserveBalance: null, avgMonthlySpend: 1080, recent: [], pendingSpent: 0 },
      { budgetId: "b2", categoryId: "c2", category: "Car Rego", group: "Auto", kind: "reserve",
        target: 50, spent: 0, reimbursed: 0, netSpent: 0, effectiveSpend: 0,
        pct: 0, remaining: 50, status: "ok", projected: null, priorSpend: 0,
        reserveBalance: 175, avgMonthlySpend: 0, recent: [], pendingSpent: 0 },
    ],
    flex: { amount: 0, categoriesIncluded: 0 },
    shadowCommitted: [],
    inbox: { categorisedInWindow: 0, inboxInWindow: 0 },
    position: { income: { actual: 0, expected: 0, expectedByNow: 0, planned: 0, recentRunRate: 0 }, expenses: { actual: 0, projected: 0, budget: 0, pending: 0 }, net: { actual: 0, projected: 0, planned: 0 } },
    unallocatedPending: 0,
    reserveBuffer: { accountId: null, balance: 0, contributions: 0, sweptThisCycle: 0, uncommitted: 0 },
  };
}

describe("snapshotRecordsFromResult", () => {
  it("maps rows to DB records with period bounds + household", () => {
    const recs = snapshotRecordsFromResult(fakeResult(), "hh1");
    expect(recs).toHaveLength(2);
    expect(recs[0]).toEqual({
      budget_id: "b1", household_id: "hh1",
      period_start: "2026-05-20", period_end: "2026-06-20",
      target: 1200, spent: 1040, reimbursed: 0, effective_spend: 1040,
      pct: 87, status: "warning", kind: "monthly_cap", reserve_balance: null, carryover: 0,
    });
  });

  it("carries reserve_balance for reserve kinds, null otherwise", () => {
    const recs = snapshotRecordsFromResult(fakeResult(), "hh1");
    expect(recs[0].reserve_balance).toBeNull();
    expect(recs[1].reserve_balance).toBe(175);
  });
});

import { shapeCategorySeries, shapeCyclesByPeriod, type RawHistoryRow } from "./snapshot";

const rawRows: RawHistoryRow[] = [
  { categoryId: "c1", period_start: "2026-05-20", period_end: "2026-06-20", target: 1200, spent: 1040, reimbursed: 0,
    effective_spend: 1040, pct: 87, status: "warning", kind: "monthly_cap", reserve_balance: null,
    carryover: 0, category: "Groceries", group: "Food" },
  { categoryId: "c1", period_start: "2026-04-20", period_end: "2026-05-20", target: 1200, spent: 900, reimbursed: 0,
    effective_spend: 900, pct: 75, status: "ok", kind: "monthly_cap", reserve_balance: null,
    carryover: 0, category: "Groceries", group: "Food" },
  { categoryId: "c2", period_start: "2026-05-20", period_end: "2026-06-20", target: 300, spent: 280, reimbursed: 0,
    effective_spend: 280, pct: 93, status: "warning", kind: "monthly_cap", reserve_balance: null,
    carryover: 0, category: "Petrol", group: "Auto" },
];

describe("shapeCategorySeries", () => {
  it("filters to one category, most-recent first", () => {
    const out = shapeCategorySeries(rawRows, "groceries");
    expect(out.found).toBe(true);
    expect(out.category).toBe("Groceries");
    expect(out.series.map((p) => p.period_start)).toEqual(["2026-05-20", "2026-04-20"]);
    expect(out.series[0].effective_spend).toBe(1040);
  });
  it("substring-matches and reports not-found", () => {
    expect(shapeCategorySeries(rawRows, "petr").found).toBe(true);
    expect(shapeCategorySeries(rawRows, "nope").found).toBe(false);
  });
});

describe("shapeCyclesByPeriod", () => {
  it("groups rows into cycles, most-recent first", () => {
    const cycles = shapeCyclesByPeriod(rawRows);
    expect(cycles.map((c) => c.period_start)).toEqual(["2026-05-20", "2026-04-20"]);
    expect(cycles[0].budgets).toHaveLength(2); // Groceries + Petrol
    expect(cycles[1].budgets).toHaveLength(1);
  });
});

import { historyByCategoryId } from "./snapshot";

describe("historyByCategoryId", () => {
  const rows: RawHistoryRow[] = [
    { categoryId: "g", period_start: "2026-05-20", period_end: "2026-06-20", target: 1200, spent: 600, reimbursed: 0, effective_spend: 600, pct: 50, status: "ok", kind: "monthly_cap", reserve_balance: null, carryover: 0, category: "Groceries", group: "Food" },
    { categoryId: "g", period_start: "2026-04-20", period_end: "2026-05-20", target: 1200, spent: 900, reimbursed: 0, effective_spend: 900, pct: 75, status: "ok", kind: "monthly_cap", reserve_balance: null, carryover: 0, category: "Groceries", group: "Food" },
    { categoryId: "p", period_start: "2026-05-20", period_end: "2026-06-20", target: 300, spent: 280, reimbursed: 0, effective_spend: 280, pct: 93, status: "warning", kind: "monthly_cap", reserve_balance: null, carryover: 0, category: "Petrol", group: "Auto" },
  ];

  it("groups rows by categoryId, newest-first within each", () => {
    const map = historyByCategoryId(rows);
    expect([...map.keys()].sort()).toEqual(["g", "p"]);
    expect(map.get("g")!.map((p) => p.period_start)).toEqual(["2026-05-20", "2026-04-20"]);
    expect(map.get("g")!).toHaveLength(2);
    expect(map.get("p")!).toHaveLength(1);
    expect(map.get("g")![0].effective_spend).toBe(600);
  });
});
