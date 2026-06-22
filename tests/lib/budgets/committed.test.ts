import { describe, it, expect } from "vitest";
import { shadowCommittedByCat } from "@/lib/budgets/committed";

const kind = (entries: [string, string, string][]) =>
  new Map(entries.map(([id, k, name]) => [id, { kind: k, name }]));

function outflows(catId: string, amounts: number[]): { amount: number; category_id: string; occurred_at: string }[] {
  return amounts.map((amt, i) => ({
    amount: -amt,
    category_id: catId,
    occurred_at: `2026-${String(3 + i).padStart(2, "0")}-15T00:00:00Z`,
  }));
}

describe("shadowCommittedByCat", () => {
  it("self-heals a recurring unbudgeted ap_amortised category (>=2 outflows)", () => {
    const txns = outflows("c1", [250, 250, 250]);
    const m = shadowCommittedByCat({
      txns,
      categoryKind: kind([["c1", "ap_amortised", "Caravan Repayments"]]),
      budgetedApCatIds: new Set(),
      rollingPeriods: 3,
    });
    expect(m.get("c1")).toMatchObject({ name: "Caravan Repayments", monthlyAvg: 250, occurrences: 3 });
  });

  it("ignores a one-off (single outflow)", () => {
    const m = shadowCommittedByCat({
      txns: outflows("c1", [900]),
      categoryKind: kind([["c1", "ap_amortised", "Annual Thing"]]),
      budgetedApCatIds: new Set(),
      rollingPeriods: 3,
    });
    expect(m.has("c1")).toBe(false);
  });

  it("excludes Mortgage Interest even when recurring", () => {
    const m = shadowCommittedByCat({
      txns: outflows("mi", [2700, 2700, 2700]),
      categoryKind: kind([["mi", "ap_amortised", "Mortgage Interest"]]),
      budgetedApCatIds: new Set(),
      rollingPeriods: 3,
    });
    expect(m.has("mi")).toBe(false);
  });

  it("skips categories that already have an active ap budget", () => {
    const m = shadowCommittedByCat({
      txns: outflows("c1", [250, 250]),
      categoryKind: kind([["c1", "ap_amortised", "Insurance"]]),
      budgetedApCatIds: new Set(["c1"]),
      rollingPeriods: 3,
    });
    expect(m.has("c1")).toBe(false);
  });

  it("ignores non-ap_amortised kinds (e.g. monthly_cap, transfer)", () => {
    const m = shadowCommittedByCat({
      txns: [...outflows("cap", [100, 100]), ...outflows("xfer", [500, 500])],
      categoryKind: kind([["cap", "monthly_cap", "Groceries"], ["xfer", "transfer", "Transfers"]]),
      budgetedApCatIds: new Set(),
      rollingPeriods: 3,
    });
    expect(m.size).toBe(0);
  });

  it("records lastDay and lastAmount from the most recent outflow", () => {
    const txns = [
      { amount: -250, category_id: "c1", occurred_at: "2026-05-08T00:00:00Z" },
      { amount: -250, category_id: "c1", occurred_at: "2026-04-08T00:00:00Z" },
    ];
    const bill = shadowCommittedByCat({
      txns,
      categoryKind: kind([["c1", "ap_amortised", "Caravan Repayments"]]),
      budgetedApCatIds: new Set(),
      rollingPeriods: 3,
    }).get("c1");
    expect(bill).toMatchObject({ lastDay: 8, lastAmount: 250 });
  });
});
