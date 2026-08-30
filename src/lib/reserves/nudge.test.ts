import { describe, it, expect } from "vitest";
import { computeSweepNudge, SWEEP_SAFETY_FLOOR } from "./nudge";

describe("computeSweepNudge", () => {
  it("computes remaining and stays uncleared when nothing swept yet", () => {
    const n = computeSweepNudge({
      recommended: 340,
      sweptThisCycle: 0,
      perReserve: [{ category: "Home Improvement", covers: 340 }],
    });
    expect(n.remaining).toBe(340);
    expect(n.outstanding).toBe(340);
    expect(n.cleared).toBe(false);
  });
  it("clears once swept meets the recommendation", () => {
    const n = computeSweepNudge({ recommended: 340, sweptThisCycle: 340, perReserve: [] });
    expect(n.remaining).toBe(0);
    expect(n.cleared).toBe(true);
  });
  it("clears when over-swept and never goes negative", () => {
    const n = computeSweepNudge({ recommended: 340, sweptThisCycle: 500, perReserve: [] });
    expect(n.remaining).toBe(0);
    expect(n.cleared).toBe(true);
  });
  it("is not 'cleared' when there is nothing to recommend", () => {
    const n = computeSweepNudge({ recommended: 0, sweptThisCycle: 0, perReserve: [] });
    expect(n.cleared).toBe(false);
  });

  it("leaves the nudge ungated when no forecast trough is supplied", () => {
    const n = computeSweepNudge({ recommended: 340, sweptThisCycle: 0, perReserve: [], trough: null });
    expect(n.cashHeadroom).toBeNull();
    expect(n.remaining).toBe(340);
    expect(n.cashCapped).toBe(false);
  });

  it("caps the sweep at the bills-day trough minus the safety floor", () => {
    // trough 900 − floor 500 = 400 headroom < 340? no, 400 > 340 → not capped
    const ok = computeSweepNudge({
      recommended: 340, sweptThisCycle: 0, perReserve: [],
      trough: { balance: 900, date: "2026-06-21" },
    });
    expect(ok.cashHeadroom).toBe(400);
    expect(ok.remaining).toBe(340);
    expect(ok.cashCapped).toBe(false);

    // trough 700 − 500 = 200 headroom < 340 plan → cash-capped to 200
    const capped = computeSweepNudge({
      recommended: 340, sweptThisCycle: 0, perReserve: [],
      trough: { balance: 700, date: "2026-06-21" },
    });
    expect(capped.cashHeadroom).toBe(200);
    expect(capped.remaining).toBe(200);
    expect(capped.outstanding).toBe(340);
    expect(capped.cashCapped).toBe(true);
  });

  it("recommends nothing (cash-blocked) when the trough is below the floor", () => {
    const n = computeSweepNudge({
      recommended: 340, sweptThisCycle: 0, perReserve: [],
      trough: { balance: SWEEP_SAFETY_FLOOR - 50, date: "2026-06-21" },
    });
    expect(n.cashHeadroom).toBe(0);
    expect(n.remaining).toBe(0);
    expect(n.outstanding).toBe(340); // plan gap remains — it's just not safe to move yet
    expect(n.cleared).toBe(false);
  });

  it("honours a custom safety floor", () => {
    const n = computeSweepNudge({
      recommended: 1000, sweptThisCycle: 0, perReserve: [],
      trough: { balance: 1200, date: "2026-06-21" }, safetyFloor: 0,
    });
    expect(n.cashHeadroom).toBe(1200);
    expect(n.remaining).toBe(1000);
  });
});
