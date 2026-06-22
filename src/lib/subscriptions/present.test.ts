import { describe, it, expect } from "vitest";
import { monthlyEquivalent, presentSubscriptions, type SubRow } from "./present";

function row(partial: Partial<SubRow>): SubRow {
  return {
    display_name: "X", cadence: "monthly", amount: 10, amount_min: 10, amount_max: 10,
    next_expected: "2026-07-01", last_seen: "2026-06-01", status: "active",
    category_id: null, ...partial,
  };
}

describe("monthlyEquivalent", () => {
  it("normalises cadences to a monthly figure", () => {
    expect(monthlyEquivalent(30, "monthly")).toBe(30);
    expect(monthlyEquivalent(120, "annual")).toBe(10);
    expect(monthlyEquivalent(13, "weekly")).toBeCloseTo(56.33, 1);
    expect(monthlyEquivalent(30, "quarterly")).toBe(10);
    expect(monthlyEquivalent(20, "fortnightly")).toBeCloseTo(43.33, 1);
  });
});

describe("presentSubscriptions", () => {
  it("sorts by annual cost desc and rolls up totals", () => {
    const out = presentSubscriptions([
      row({ display_name: "Cheap", amount: 5, cadence: "monthly" }),
      row({ display_name: "Pricey", amount: 200, cadence: "annual" }),
    ]);
    expect(out.subscriptions[0].displayName).toBe("Pricey");
    expect(out.totals.count).toBe(2);
    expect(out.totals.monthly).toBeCloseTo(5 + 200 / 12, 2);
  });

  it("flags a price change when range exceeds tolerance", () => {
    const out = presentSubscriptions([row({ amount: 10, amount_min: 10, amount_max: 13 })]);
    expect(out.subscriptions[0].priceChanged).toBe(true);
  });

  it("excludes lapsed subs from totals but still returns them", () => {
    const out = presentSubscriptions([
      row({ display_name: "Live", amount: 10, status: "active" }),
      row({ display_name: "Dead", amount: 99, status: "lapsed" }),
    ]);
    expect(out.totals.count).toBe(1);
    expect(out.totals.monthly).toBe(10);
    expect(out.subscriptions).toHaveLength(2);
  });
});
