import { describe, it, expect } from "vitest";
import { decideSweepNudge, formatSweepNudge } from "./sweep";
import type { SweepNudge } from "@/lib/reserves/nudge";

const base: SweepNudge = {
  recommended: 340, sweptThisCycle: 0, outstanding: 340, remaining: 340,
  cashHeadroom: null, cashCapped: false, billsBalance: null, billsDate: null,
  cleared: false, perReserve: [{ category: "Home Improvement", covers: 340 }],
};

describe("decideSweepNudge", () => {
  it("fires when there is a remaining sweep and none fired this cycle", () => {
    expect(decideSweepNudge(base, false)).toBe(true);
  });
  it("does not fire when already fired this cycle", () => {
    expect(decideSweepNudge(base, true)).toBe(false);
  });
  it("does not fire when nothing remains to sweep", () => {
    expect(decideSweepNudge({ ...base, remaining: 0, cleared: true }, false)).toBe(false);
  });
  it("does not fire when cash-blocked (plan spare but no safe headroom)", () => {
    expect(decideSweepNudge({ ...base, remaining: 0, outstanding: 340, cashCapped: true }, false)).toBe(false);
  });
});

describe("formatSweepNudge", () => {
  it("names the amount and what it covers (plan-only, no forecast)", () => {
    const line = formatSweepNudge(base);
    expect(line).toContain("340");
    expect(line).toContain("Home Improvement");
  });

  it("states the cash left for bills day when a forecast is present", () => {
    const line = formatSweepNudge({
      ...base, remaining: 340, billsBalance: 1200, billsDate: "2026-06-21",
    });
    // leftover = 1200 − 340 = 860, on the 21st
    expect(line).toContain("860");
    expect(line).toContain("21st");
  });

  it("flags the deferred remainder when cash-capped", () => {
    const line = formatSweepNudge({
      ...base, recommended: 340, outstanding: 340, remaining: 200,
      cashHeadroom: 200, cashCapped: true, billsBalance: 700, billsDate: "2026-06-21",
    });
    expect(line).toContain("200");
    expect(line).toContain("once payday lands");
    expect(line).toContain("140"); // 340 outstanding − 200 swept now
  });
});
