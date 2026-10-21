import { describe, it, expect } from "vitest";
import { incomeTrendGeometry } from "./trend-geometry";
import type { IncomeCyclePoint } from "./history";

const cyclesNewestFirst: IncomeCyclePoint[] = [
  {
    period_start: "2026-05-20", period_end: "2026-06-20", total: 9750, plannedTotal: 11150,
    sources: [
      { categoryId: "salary", name: "Salary", actual: 9200, plan: 10600 },
      { categoryId: "ece", name: "Partner ECE Income", actual: 550, plan: 550 },
    ],
  },
  {
    period_start: "2026-04-20", period_end: "2026-05-20", total: 11150, plannedTotal: 11150,
    sources: [
      { categoryId: "salary", name: "Salary", actual: 10600, plan: 10600 },
      { categoryId: "ece", name: "Partner ECE Income", actual: 550, plan: 550 },
    ],
  },
];

describe("incomeTrendGeometry", () => {
  it("scales to max of (any total, plannedTotal) and orders bars oldest->newest", () => {
    const geo = incomeTrendGeometry(cyclesNewestFirst)!;
    expect(geo).not.toBeNull();
    expect(geo.scaleMax).toBe(11150);
    expect(geo.planFrac).toBeCloseTo(1, 5);
    expect(geo.bars.map((b) => b.period_start)).toEqual(["2026-04-20", "2026-05-20"]);
    expect(geo.bars[1].totalFrac).toBeCloseTo(9750 / 11150, 5);
  });

  it("stacks segments cumulatively in source order with stepped opacity", () => {
    const geo = incomeTrendGeometry(cyclesNewestFirst)!;
    const bar = geo.bars[1];
    expect(bar.segments.map((s) => s.categoryId)).toEqual(["salary", "ece"]);
    expect(bar.segments[0].fracStart).toBeCloseTo(0, 5);
    expect(bar.segments[0].fracEnd).toBeCloseTo(9200 / 11150, 5);
    expect(bar.segments[1].fracStart).toBeCloseTo(9200 / 11150, 5);
    expect(bar.segments[1].fracEnd).toBeCloseTo(9750 / 11150, 5);
    expect(bar.segments[0].alpha).toBeGreaterThan(bar.segments[1].alpha);
  });

  it("returns null when there is nothing to scale", () => {
    expect(incomeTrendGeometry([])).toBeNull();
    const allZero: IncomeCyclePoint[] = [{
      period_start: "2026-05-20", period_end: "2026-06-20", total: 0, plannedTotal: 0, sources: [],
    }];
    expect(incomeTrendGeometry(allZero)).toBeNull();
  });
});
