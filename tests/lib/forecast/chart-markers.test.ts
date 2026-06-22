import { describe, it, expect } from "vitest";
import { paydayIndexes } from "@/lib/forecast/chart-markers";

describe("paydayIndexes", () => {
  it("flags days whose balance rises above the previous day", () => {
    // down, down, PAY(up), down, PAY(up)
    const balances = [1000, 900, 800, 2800, 2700, 4700];
    expect(paydayIndexes(balances)).toEqual([3, 5]);
  });

  it("never flags index 0 (no prior day) and ignores flat days", () => {
    expect(paydayIndexes([500, 500, 500])).toEqual([]);
  });

  it("returns empty for a strictly declining series", () => {
    expect(paydayIndexes([1000, 900, 800, 700])).toEqual([]);
  });

  it("handles short series", () => {
    expect(paydayIndexes([])).toEqual([]);
    expect(paydayIndexes([100])).toEqual([]);
    expect(paydayIndexes([100, 200])).toEqual([1]);
  });
});
