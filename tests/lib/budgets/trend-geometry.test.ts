import { describe, it, expect } from "vitest";
import { trendBarGeometry } from "@/lib/budgets/trend-geometry";
import { ragRole, incomeRole } from "@/components/charts/theme";
import type { HistoryPoint } from "@/lib/budgets/snapshot";

function pt(over: Partial<HistoryPoint>): HistoryPoint {
  return {
    period_start: "2026-05-20", period_end: "2026-06-20", target: 1200, spent: 0,
    reimbursed: 0, effective_spend: 0, pct: 0, status: "ok", kind: "monthly_cap",
    reserve_balance: null, carryover: 0, ...over,
  };
}

describe("trendBarGeometry", () => {
  it("returns null for an empty series", () => {
    expect(trendBarGeometry([])).toBeNull();
  });

  it("scales bars to a target-inclusive denominator; newest-first input rendered oldest-first", () => {
    const series = [
      pt({ period_start: "2026-05-20", effective_spend: 600, status: "ok" }),
      pt({ period_start: "2026-04-20", effective_spend: 1200, status: "warning" }),
      pt({ period_start: "2026-03-20", effective_spend: -100, status: "ok" }),
    ];
    const g = trendBarGeometry(series)!;
    expect(g.bars.map((b) => b.label)).toEqual(["Mar", "Apr", "May"]);
    expect(g.bars[0].heightPct).toBe(0); // -100 clamps to 0
    expect(g.bars[1].heightPct).toBe(100); // 1200/1200
    expect(g.bars[2].heightPct).toBe(50); // 600/1200
    expect(g.targetPct).toBe(100);
    expect(g.target).toBe(1200);
    expect(g.avg).toBe(900); // (1200+600)/2, excludes the -100 net-credit cycle
    expect(g.avgPct).toBe(75);
  });

  it("preserves status/kind so the renderer can colour by expense RAG", () => {
    const g = trendBarGeometry([pt({ effective_spend: 100, status: "over" })])!;
    expect(g.bars[0].kind).toBe("monthly_cap");
    expect(g.bars[0].status).toBe("over");
    expect(ragRole(g.bars[0].status)).toBe("negative");
  });

  it("for income, bars show received (-effective_spend) with inverted RAG facts", () => {
    const series = [
      pt({ period_start: "2026-05-20", kind: "income", target: 3000, effective_spend: -3000 }), // 100%
      pt({ period_start: "2026-04-20", kind: "income", target: 3000, effective_spend: -2500 }), // 83%
    ];
    const g = trendBarGeometry(series)!;
    expect(g.bars.map((b) => b.label)).toEqual(["Apr", "May"]); // oldest → newest
    // denom = max(target 3000, received 3000, 2500) = 3000
    expect(g.bars[0].heightPct).toBeCloseTo((2500 / 3000) * 100, 5); // Apr
    expect(g.bars[1].heightPct).toBe(100); // May
    expect(g.bars[0].value).toBe(2500);
    expect(g.bars[1].value).toBe(3000);
    // inverted RAG via pctOfTarget: >=100 green, >=80 amber, else red
    expect(incomeRole(g.bars[0].pctOfTarget)).toBe("warning"); // 83%
    expect(incomeRole(g.bars[1].pctOfTarget)).toBe("positive"); // 100%
    expect(g.target).toBe(3000);
    expect(g.avg).toBe(2750); // (3000 + 2500) / 2
  });
});

describe("ragRole / incomeRole", () => {
  it("expense RAG: ok→positive, warning→warning, over→negative", () => {
    expect(ragRole("ok")).toBe("positive");
    expect(ragRole("warning")).toBe("warning");
    expect(ragRole("over")).toBe("negative");
  });
  it("income RAG is inverted by pct-of-target", () => {
    expect(incomeRole(120)).toBe("positive");
    expect(incomeRole(100)).toBe("positive");
    expect(incomeRole(90)).toBe("warning");
    expect(incomeRole(50)).toBe("negative");
  });
});
