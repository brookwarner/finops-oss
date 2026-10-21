import { expect, it } from "vitest";
import { loadIncomeFallback } from "@/lib/forecast/loaders";
it("adds each dependable income budget and excludes irregular receipts", () => {
  expect(loadIncomeFallback([
    { kind: "income", monthly_target: 5000, categories: { income_type: "salary" } },
    { kind: "income", monthly_target: 3000, categories: [{ income_type: "recurring" }] },
    { kind: "income", monthly_target: 10000, categories: { income_type: "one_off" } },
    { kind: "income", monthly_target: 10000, categories: { income_type: "irregular" } },
    { kind: "monthly_cap", monthly_target: 1000 },
  ])).toEqual({ day: 15, amount: 8000 });
});
it("returns no fallback without dependable income budgets", () => {
  expect(loadIncomeFallback([])).toBeNull();
  expect(loadIncomeFallback([{ kind: "income", monthly_target: 5000,
    categories: { income_type: "irregular" } }])).toBeNull();
});
