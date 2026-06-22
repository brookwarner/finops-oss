import { describe, it, expect } from "vitest";
import { spendingVsPlanGeometry } from "@/lib/budgets/spending-vs-plan-geometry";
import type { Position } from "@/lib/budgets/position";

function pos(over: Partial<Position> = {}): Position {
  return {
    income: { actual: 7349, expected: 11270, expectedByNow: 8753, planned: 11270, recentRunRate: 9866 },
    expenses: { actual: 9279, projected: 10522, budget: 10010, pending: 288 },
    net: { actual: -1930, projected: 748, planned: 1260 },
    ...over,
  };
}

describe("spendingVsPlanGeometry", () => {
  it("nests spent ⊆ caps ⊆ planned income on a planned-income scale", () => {
    const g = spendingVsPlanGeometry(pos());
    expect(g.hasPlan).toBe(true);
    expect(g.scaleMax).toBe(11270);
    expect(g.spent.value).toBe(9279);
    expect(g.capsUnspent.value).toBe(731);
    expect(g.headroom.value).toBe(1260);
    expect(g.overCap).toBe(0);
    expect(g.capsUsedPct).toBe(93);
    expect(g.structurePerMo).toBe(1260);
  });

  it("zero-fills caps-unspent and reports overCap when spend exceeds caps", () => {
    const g = spendingVsPlanGeometry(pos({
      expenses: { actual: 10500, projected: 11000, budget: 10010, pending: 0 },
    }));
    expect(g.capsUnspent.value).toBe(0);
    expect(g.overCap).toBe(490);
    expect(g.capsUsedPct).toBe(105);
  });

  it("drops headroom and scales to budget when there is no income plan", () => {
    const g = spendingVsPlanGeometry(pos({
      income: { actual: 7349, expected: 9866, expectedByNow: 0, planned: 0, recentRunRate: 9866 },
      net: { actual: -1930, projected: 587, planned: -10010 },
    }));
    expect(g.hasPlan).toBe(false);
    expect(g.headroom.value).toBe(0);
    expect(g.scaleMax).toBe(10010);
  });
});
