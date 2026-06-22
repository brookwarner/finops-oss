import { describe, it, expect } from "vitest";
import { incomePaceGeometry, type IncomePoint } from "@/lib/budgets/income-pace-geometry";

const SERIES: IncomePoint[] = [
  { periodStart: "2026-02-20", label: "Feb", total: 11959, isCurrent: false },
  { periodStart: "2026-03-20", label: "Mar", total: 7441, isCurrent: false },
  { periodStart: "2026-04-20", label: "Apr", total: 10199, isCurrent: false },
  { periodStart: "2026-05-20", label: "May", total: 9866, isCurrent: false },
  { periodStart: "2026-06-20", label: "now", total: 7349, isCurrent: true },
];

describe("incomePaceGeometry", () => {
  it("scales bars to a max that includes the plan and all totals", () => {
    const g = incomePaceGeometry(SERIES, 11270, 8753);
    expect(g.scaleMax).toBeGreaterThanOrEqual(11959);
    expect(g.bars).toHaveLength(5);
    const tallest = Math.max(...g.bars.map((b) => b.heightPct));
    expect(tallest).toBeLessThanOrEqual(100);
  });

  it("places the plan line and the pace marker on the same scale", () => {
    const g = incomePaceGeometry(SERIES, 11270, 8753);
    expect(g.planPct).toBeCloseTo((11270 / g.scaleMax) * 100, 5);
    expect(g.paceMarker).not.toBeNull();
    expect(g.paceMarker!.barIndex).toBe(4);
    expect(g.paceMarker!.heightPct).toBeCloseTo((8753 / g.scaleMax) * 100, 5);
  });

  it("returns no pace marker when there is no current cycle", () => {
    const g = incomePaceGeometry(SERIES.map((p) => ({ ...p, isCurrent: false })), 11270, 8753);
    expect(g.paceMarker).toBeNull();
  });

  it("marks the current bar", () => {
    const g = incomePaceGeometry(SERIES, 11270, 8753);
    expect(g.bars[4].isCurrent).toBe(true);
    expect(g.bars.slice(0, 4).every((b) => !b.isCurrent)).toBe(true);
  });
});
