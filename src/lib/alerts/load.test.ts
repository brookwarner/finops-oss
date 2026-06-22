import { describe, it, expect } from "vitest";
import { capSnapshotsFromRows } from "@/lib/alerts/load";
import type { BudgetStatusRow } from "@/lib/budgets/compute";

function row(over: Partial<BudgetStatusRow>): BudgetStatusRow {
  return {
    budgetId: "b", categoryId: "c", category: "Groceries", group: "Food", kind: "monthly_cap",
    target: 1200, spent: 1240, reimbursed: 0, netSpent: 1240, effectiveSpend: 1240,
    pct: 103, remaining: -40, status: "over", projected: null, priorSpend: 0,
    reserveBalance: null, avgMonthlySpend: 0, recent: [], pendingSpent: 0, ...over,
  };
}

describe("capSnapshotsFromRows", () => {
  it("maps a monthly_cap row to a snapshot carrying status, amounts, and daysLeft", () => {
    const snaps = capSnapshotsFromRows([row({})], 6);
    expect(snaps).toEqual([
      { categoryId: "c", category: "Groceries", state: "over",
        target: 1200, netSpent: 1240, pct: 103, remaining: -40, daysLeft: 6 },
    ]);
  });

  it("excludes non-cap budgets (reserve, ap_amortised, income)", () => {
    const rows = [
      row({ categoryId: "cap", kind: "monthly_cap" }),
      row({ categoryId: "res", kind: "reserve" }),
      row({ categoryId: "ap", kind: "ap_amortised" }),
      row({ categoryId: "inc", kind: "income" }),
    ];
    const snaps = capSnapshotsFromRows(rows, 10);
    expect(snaps.map((s) => s.categoryId)).toEqual(["cap"]);
  });

  it("maps RAG status to threshold state", () => {
    expect(capSnapshotsFromRows([row({ status: "ok" })], 1)[0].state).toBe("ok");
    expect(capSnapshotsFromRows([row({ status: "warning" })], 1)[0].state).toBe("warning");
    expect(capSnapshotsFromRows([row({ status: "over" })], 1)[0].state).toBe("over");
  });
});
