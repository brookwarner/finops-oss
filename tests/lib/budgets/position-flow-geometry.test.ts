import { describe, it, expect } from "vitest";
import { positionFlowGeometry } from "@/lib/budgets/position-flow-geometry";
import type { Position } from "@/lib/budgets/position";

function pos(over: Partial<Position> = {}): Position {
  return {
    income: { actual: 7349, expected: 11270, expectedByNow: 8753, planned: 11270, recentRunRate: 9866, expectedInflows: 0 },
    expenses: { actual: 9279, projected: 10522, budget: 10010, pending: 288 },
    net: { actual: -1930, projected: 748, planned: 1260 },
    ...over,
  };
}

describe("positionFlowGeometry", () => {
  it("splits each bar into solid (actual) and ghost (projected remainder)", () => {
    const g = positionFlowGeometry(pos());
    expect(g.in.actual).toBe(7349);
    expect(g.in.projected).toBe(11270);
    expect(g.in.ghostPct).toBeGreaterThan(0);
    expect(g.out.projected).toBe(10522);
    expect(g.out.ghostPct).toBeGreaterThan(0);
  });

  it("scales both bars to a shared max with headroom so the longest never hits 100%", () => {
    const g = positionFlowGeometry(pos());
    expect(g.scaleMax).toBeGreaterThan(11270);
    expect(g.in.solidPct + g.in.ghostPct).toBeLessThan(100);
  });

  it("reports projected surplus and a non-zero overhang when In-projected > Out-projected", () => {
    const g = positionFlowGeometry(pos());
    expect(g.projectedNet).toBe(748);
    expect(g.overhang.surplus).toBe(true);
    expect(g.overhang.widthPct).toBeGreaterThan(0);
  });

  it("flags a shortfall when projected spend exceeds projected income", () => {
    const g = positionFlowGeometry(pos({
      income: { actual: 5000, expected: 9000, expectedByNow: 7000, planned: 9000, recentRunRate: 8000, expectedInflows: 0 },
      expenses: { actual: 8000, projected: 9800, budget: 9500, pending: 0 },
      net: { actual: -3000, projected: -800, planned: -500 },
    }));
    expect(g.projectedNet).toBe(-800);
    expect(g.overhang.surplus).toBe(false);
  });

  it("collapses the ghost to zero when nothing is left to project (all-solid bar)", () => {
    const g = positionFlowGeometry(pos({
      expenses: { actual: 10522, projected: 10522, budget: 10010, pending: 0 },
    }));
    expect(g.out.ghostPct).toBe(0);
    expect(g.out.complete).toBe(true);
  });

  it("puts the end-cap at the projected end, and flags an in-progress bar incomplete", () => {
    const g = positionFlowGeometry(pos());
    expect(g.in.projectedPct).toBeCloseTo(g.in.solidPct + g.in.ghostPct, 10);
    expect(g.out.projectedPct).toBeCloseTo(g.out.solidPct + g.out.ghostPct, 10);
    expect(g.in.complete).toBe(false);
    expect(g.out.complete).toBe(false);
  });

  it("marks an all-solid In bar complete so the card can explain the missing hatch", () => {
    // Irregular-income case: no forward-projecting income budget and no logged
    // receivable, so expected === actual and the In bar never grows a hatch.
    const g = positionFlowGeometry(pos({
      income: { actual: 5020, expected: 5020, expectedByNow: 0, planned: 0, recentRunRate: 18447, expectedInflows: 0 },
      expenses: { actual: 6691, projected: 9475, budget: 11372, pending: 254 },
      net: { actual: -1671, projected: -4455, planned: -11357 },
    }));
    expect(g.in.complete).toBe(true);
    expect(g.in.ghostPct).toBe(0);
    // The bar still sits mid-track because the scale is shared with the longer
    // Out bar — that is exactly why the card must not draw a goal-like container.
    expect(g.in.solidPct).toBeLessThan(60);
    expect(g.in.projectedPct).toBe(g.in.solidPct);
    expect(g.overhang.surplus).toBe(false);
  });
});
