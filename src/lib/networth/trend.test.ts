import { describe, it, expect } from "vitest";
import { buildNetWorthTrend, type SnapshotRecord } from "./trend";

function snap(date: string, net: number, assets = net, liabilities = 0): SnapshotRecord {
  return { snapshot_date: date, net, assets, liabilities };
}

describe("buildNetWorthTrend", () => {
  it("sorts points ascending by date regardless of input order", () => {
    const t = buildNetWorthTrend([
      snap("2026-06-03", 300),
      snap("2026-06-01", 100),
      snap("2026-06-02", 200),
    ]);
    expect(t.points.map((p) => p.date)).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
    expect(t.earliest?.net).toBe(100);
    expect(t.latest?.net).toBe(300);
  });

  it("computes change and percentage across the window", () => {
    const t = buildNetWorthTrend([snap("2026-06-01", 1000), snap("2026-06-10", 1250)]);
    expect(t.change).toBe(250);
    expect(t.changePct).toBeCloseTo(25, 5);
  });

  it("reports zero change and null pct for an empty series", () => {
    const t = buildNetWorthTrend([]);
    expect(t.points).toEqual([]);
    expect(t.latest).toBeNull();
    expect(t.earliest).toBeNull();
    expect(t.change).toBe(0);
    expect(t.changePct).toBeNull();
  });

  it("handles a single point (no change, no pct)", () => {
    const t = buildNetWorthTrend([snap("2026-06-04", 500)]);
    expect(t.change).toBe(0);
    expect(t.changePct).toBeNull();
    expect(t.latest?.net).toBe(500);
  });

  it("suppresses pct when the earliest net is non-positive", () => {
    const t = buildNetWorthTrend([snap("2026-06-01", -100), snap("2026-06-05", 50)]);
    expect(t.change).toBe(150);
    expect(t.changePct).toBeNull();
  });
});
