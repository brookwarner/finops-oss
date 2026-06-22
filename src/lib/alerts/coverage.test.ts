import { describe, it, expect } from "vitest";
import { decideCoverageAlerts } from "@/lib/alerts/coverage";
import type { ShadowBill } from "@/lib/budgets/committed";

const bill = (over: Partial<ShadowBill> = {}): ShadowBill => ({
  categoryId: "c1", name: "Caravan Repayments", monthlyAvg: 250, occurrences: 3, lastDay: 8, lastAmount: 250, ...over,
});

describe("decideCoverageAlerts", () => {
  it("fires one alert per shadow bill not already alerted this cycle", () => {
    const events = decideCoverageAlerts({
      householdId: "hh", periodStart: "2026-05-20",
      shadowBills: [bill()],
      alreadyAlertedCatIds: new Set(),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      household_id: "hh", type: "budget_coverage_gap", category_id: "c1",
      period_start: "2026-05-20", delivered: false,
    });
    expect(events[0].body).toContain("Caravan Repayments");
  });

  it("dedups against categories already alerted this cycle", () => {
    const events = decideCoverageAlerts({
      householdId: "hh", periodStart: "2026-05-20",
      shadowBills: [bill()],
      alreadyAlertedCatIds: new Set(["c1"]),
    });
    expect(events).toHaveLength(0);
  });

  it("returns nothing when there are no shadow bills", () => {
    expect(decideCoverageAlerts({
      householdId: "hh", periodStart: "2026-05-20", shadowBills: [], alreadyAlertedCatIds: new Set(),
    })).toHaveLength(0);
  });
});
