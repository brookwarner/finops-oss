import { describe, it, expect } from "vitest";
import { netWorthDomain } from "@/lib/networth/chart-domain";

describe("netWorthDomain", () => {
  it("autoscales to the data when the swing exceeds the min band", () => {
    // range 0..1000 on magnitude 1000 → band 1000 >> floor (0.04*1000=40)
    const [lo, hi] = netWorthDomain([0, 500, 1000]);
    expect(lo).toBe(0);
    expect(hi).toBe(1000);
  });

  it("widens to the min band for a trivial move so it doesn't read as a cliff", () => {
    // values ~1,000,000 moving by $10. Raw band = 10; floor = 0.04 * magnitude,
    // where magnitude = max(|min|,|max|,1) = 1_000_010 → 40000.4.
    const [lo, hi] = netWorthDomain([1_000_000, 1_000_010]);
    expect(hi - lo).toBeCloseTo(0.04 * 1_000_010, 4);
    // band stays centred on the data mid-point
    expect((lo + hi) / 2).toBeCloseTo(1_000_005, 4);
  });

  it("uses a magnitude floor of 1 so a flat zero series still yields a band", () => {
    const [lo, hi] = netWorthDomain([0, 0]);
    expect(hi - lo).toBeCloseTo(0.04, 5);
  });

  it("handles negative net worth via magnitude", () => {
    const [lo, hi] = netWorthDomain([-50_000, -50_000]);
    expect(hi - lo).toBeCloseTo(0.04 * 50_000, 5);
    expect((lo + hi) / 2).toBeCloseTo(-50_000, 5);
  });
});
