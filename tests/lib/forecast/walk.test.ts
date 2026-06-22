import { describe, it, expect } from "vitest";
import { walkSeries } from "@/lib/forecast/walk";
import type { ForecastEvent } from "@/lib/forecast/events";

const NOW = new Date(Date.UTC(2026, 5, 14)); // 2026-06-14
const ev = (date: string, delta: number): ForecastEvent => ({ date, delta, label: "x", kind: "income" });

describe("walkSeries", () => {
  it("emits horizonDays + 1 points, starting at day 0", () => {
    const series = walkSeries(NOW, 3, 100, []);
    expect(series).toHaveLength(4);
    expect(series[0]).toEqual({ date: "2026-06-14", balance: 100 });
    expect(series[3].date).toBe("2026-06-17");
    expect(series.every((p) => p.balance === 100)).toBe(true);
  });

  it("applies each day's net delta and carries the balance forward", () => {
    const series = walkSeries(NOW, 3, 100, [ev("2026-06-15", 50), ev("2026-06-16", -20)]);
    expect(series.map((p) => p.balance)).toEqual([100, 150, 130, 130]);
  });

  it("sums multiple events landing on the same date", () => {
    const series = walkSeries(NOW, 1, 0, [ev("2026-06-14", 10), ev("2026-06-14", 5)]);
    expect(series[0].balance).toBe(15);
  });

  it("rounds balances to 2dp", () => {
    const series = walkSeries(NOW, 1, 0, [ev("2026-06-14", 0.1), ev("2026-06-14", 0.2)]);
    expect(series[0].balance).toBe(0.3);
  });
});
