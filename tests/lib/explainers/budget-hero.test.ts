import { describe, it, expect } from "vitest";
import { explainPosition, explainSpendingVsPlan, explainBills } from "@/lib/explainers/budget-hero";
import type { Position } from "@/lib/budgets/position";
import type { ForecastResult } from "@/lib/forecast/compute";

const basePosition: Position = {
  income: {
    actual: 7349,
    expected: 11270,
    expectedByNow: 0,
    planned: 11270,
    recentRunRate: 9866,
  },
  expenses: { actual: 9307, projected: 10280, budget: 0, pending: 0 },
  net: { actual: -1958, projected: 990, planned: 11270 },
};

describe("explainPosition", () => {
  it("builds the cashflow legend with live formatted values", () => {
    const e = explainPosition(basePosition);

    expect(e.title).toBe("Position");
    expect(e.answers).toBe("Will this cycle end in surplus?");
    expect(e.rows).toHaveLength(4);

    const [paceRow, soFarRow, inRow, outRow] = e.rows;

    expect(paceRow.line).toBe("+$990 projected by cycle end");
    expect(paceRow.meaning).toContain("$11,270");
    expect(paceRow.meaning).toContain("$10,280");
    expect(paceRow.meaning).toContain("$7,349");

    expect(soFarRow.line).toBe("−$1,958 so far");
    expect(soFarRow.meaning).toContain("$7,349");
    expect(soFarRow.meaning).toContain("$9,307");

    expect(inRow.line).toBe("In $7,349 → $11,270");
    expect(outRow.line).toBe("Out $9,307 → $10,280");
  });

  it("adds a pending row only when there is unsettled spend", () => {
    const withoutPending = explainPosition(basePosition);
    expect(withoutPending.rows.some((r) => r.line.includes("pending"))).toBe(false);

    const withPending = explainPosition({
      ...basePosition,
      expenses: { ...basePosition.expenses, pending: 120 },
    });
    expect(withPending.rows).toHaveLength(5);
    expect(withPending.rows[withPending.rows.length - 1].line).toBe("+$120 pending");
  });
});

describe("explainSpendingVsPlan", () => {
  it("adds the structural plan-vs-plan row when both plan and budget caps exist", () => {
    const e = explainSpendingVsPlan({
      ...basePosition,
      expenses: { ...basePosition.expenses, budget: 9540 },
      net: { ...basePosition.net, planned: 1730 },
    });

    const structural = e.rows[e.rows.length - 1];
    expect(structural.line).toBe("+$1,730/mo headroom");
    expect(structural.meaning).toContain("$9,540");
    expect(structural.meaning).toContain("$11,270");
  });

  it("labels the structural row 'over' when budgets exceed planned income", () => {
    const e = explainSpendingVsPlan({
      ...basePosition,
      expenses: { ...basePosition.expenses, budget: 12000 },
      net: { ...basePosition.net, planned: -730 },
    });
    const structural = e.rows[e.rows.length - 1];
    expect(structural.line).toBe("−$730/mo over");
  });

  it("drops the structural row when planned income is 0", () => {
    const e = explainSpendingVsPlan({
      ...basePosition,
      income: { ...basePosition.income, planned: 0 },
      expenses: { ...basePosition.expenses, budget: 9540 },
    });

    expect(e.rows.some((r) => r.line.includes("/mo"))).toBe(false);
  });
});

function makeForecast(over: Partial<ForecastResult>): ForecastResult {
  return {
    startBalance: 5000,
    trough: { date: "2026-06-18", balance: 1160 },
    nextPayday: { date: "2026-06-20", amount: 2300 },
    billsDue: { date: "2026-06-15", amount: 800, count: 3 },
    verdict: { makesIt: true, margin: 1160, text: "" },
    ...over,
  } as ForecastResult;
}

describe("explainBills", () => {
  it("builds the legend with the bills row when billsDue is set", () => {
    const e = explainBills(makeForecast({}));

    expect(e.title).toBe("Can I pay my bills?");
    expect(e.answers).toBe("Will my bank balance survive until the next bills clear?");
    expect(e.rows).toHaveLength(3);

    expect(e.rows[0].line).toBe("$1,160 to spare");
    expect(e.rows[1].line).toBe("Lowest $1,160 on 2026-06-18");
    expect(e.rows[2].line).toBe("bills 2026-06-15");
  });

  it("shows the pay row when billsDue is null but nextPayday is set", () => {
    const e = explainBills(makeForecast({ billsDue: null }));

    expect(e.rows).toHaveLength(3);
    expect(e.rows[2].line).toBe("pay 2026-06-20");
  });

  it("omits the third row when both billsDue and nextPayday are null", () => {
    const e = explainBills(makeForecast({ billsDue: null, nextPayday: null }));

    expect(e.rows).toHaveLength(2);
  });

  it("formats a negative trough as a clean magnitude (sense carried by meaning)", () => {
    const e = explainBills(
      makeForecast({ trough: { date: "2026-06-18", balance: -420 } }),
    );

    expect(e.rows[0].line).toBe("$420 to spare");
    expect(e.rows[1].line).toBe("Lowest $420 on 2026-06-18");
  });
});
