import { describe, it, expect } from "vitest";
import { shapeDailyBurn, type BurnTxn } from "./daily-burn";
import { dailyBurnGeometry } from "./daily-burn-geometry";
import type { Period } from "@/lib/budgets/period";

// A 31-day cycle: 20 May → 20 Jun (May has 31 days). Matches the 20th-to-20th
// pay cycle the app uses. A 620/mo cap lands on a clean $20/day plan.
const period: Period = {
  start: new Date(Date.UTC(2026, 4, 20)),
  end: new Date(Date.UTC(2026, 5, 20)),
};

function txn(date: string, amount: number): BurnTxn {
  // Outflows are stored negative; pass a spend magnitude as a positive `mag`
  // through `-mag` at call sites for readability.
  return { occurred_at: `${date}T08:00:00Z`, amount };
}

describe("shapeDailyBurn", () => {
  it("buckets outflows by UTC day and zero-fills empty days", () => {
    // now = day 5 of the cycle (24 May). plannedMonthlyCap 600 over 30 days = $20/day.
    const now = new Date(Date.UTC(2026, 4, 24, 12));
    const txns = [txn("2026-05-20", -10), txn("2026-05-20", -5), txn("2026-05-22", -30)];
    const r = shapeDailyBurn(txns, period, 620, { now });

    expect(r.periodLength).toBe(31);
    expect(r.dayOfPeriod).toBe(5);
    expect(r.days).toHaveLength(5);
    expect(r.days[0]).toMatchObject({ date: "2026-05-20", spend: 15, dayOfCycle: 1 });
    expect(r.days[1].spend).toBe(0); // 21 May — no txns
    expect(r.days[2].spend).toBe(30); // 22 May
    expect(r.days[3].spend).toBe(0);
    expect(r.days[4].spend).toBe(0);
    expect(r.plannedPerDay).toBe(20);
    expect(r.spentSoFar).toBe(45);
    expect(r.cyclePerDay).toBe(9); // 45 / 5
  });

  it("nets refunds within a day (inflow reduces burn)", () => {
    const now = new Date(Date.UTC(2026, 4, 21, 12)); // day 2
    const txns = [txn("2026-05-20", -50), txn("2026-05-20", 20)]; // spent 50, refunded 20
    const r = shapeDailyBurn(txns, period, 0, { now });
    expect(r.days[0].spend).toBe(30);
  });

  it("ignores transactions outside the elapsed window (future/prior cycle)", () => {
    const now = new Date(Date.UTC(2026, 4, 22, 12)); // day 3
    const txns = [
      txn("2026-05-19", -100), // prior cycle
      txn("2026-05-21", -40), // in window
      txn("2026-05-25", -200), // future (after now)
    ];
    const r = shapeDailyBurn(txns, period, 0, { now });
    expect(r.days).toHaveLength(3);
    expect(r.spentSoFar).toBe(40);
  });

  it("computes trailing pace and flags it over plan", () => {
    // now = day 14. $40/day for the last 7 days, $0 before. plan $20/day.
    const now = new Date(Date.UTC(2026, 5, 2, 12)); // 2 Jun = day 14
    const txns: BurnTxn[] = [];
    for (let d = 7; d < 14; d++) {
      const date = new Date(Date.UTC(2026, 4, 20 + d)).toISOString().slice(0, 10);
      txns.push(txn(date, -40));
    }
    const r = shapeDailyBurn(txns, period, 620, { now }); // plan 620/31 = 20
    expect(r.trailingDays).toBe(7);
    expect(r.trailingPerDay).toBe(40);
    expect(r.priorPerDay).toBe(0); // the 7 days before were empty
    expect(r.vsPlan).toBe(20); // 40 − 20, burning hot
    expect(r.trend).toBe(40); // 40 − 0, pace rising sharply
  });

  it("clamps the trailing window and leaves priorPerDay null early in the cycle", () => {
    const now = new Date(Date.UTC(2026, 4, 23, 12)); // day 4 — fewer than 7 days elapsed
    const r = shapeDailyBurn([txn("2026-05-20", -16)], period, 0, { now });
    expect(r.trailingDays).toBe(4);
    expect(r.priorPerDay).toBeNull();
    expect(r.trailingPerDay).toBe(4); // 16 over 4 days
  });
});

describe("dailyBurnGeometry", () => {
  it("scales bars and reference lines onto a shared axis", () => {
    const now = new Date(Date.UTC(2026, 4, 22, 12)); // day 3
    const r = shapeDailyBurn([txn("2026-05-20", -60), txn("2026-05-21", -10)], period, 600, { now });
    const geo = dailyBurnGeometry(r);

    expect(geo.bars).toHaveLength(3);
    // scaleMax = max(60, plan 20, trailing) * 1.05 → 60 is the tallest bar
    expect(geo.bars[0].heightPct).toBeGreaterThan(90);
    expect(geo.bars[0].overPlan).toBe(true); // 60 > 20
    expect(geo.bars[2].overPlan).toBe(false); // 0 ≤ 20
    expect(geo.planPct).toBeLessThan(geo.bars[0].heightPct);
    expect(geo.bars[0].label).toBe("20");
  });

  it("clamps a refund (negative) day to a zero-height bar", () => {
    const now = new Date(Date.UTC(2026, 4, 21, 12)); // day 2
    const r = shapeDailyBurn([txn("2026-05-20", 50)], period, 600, { now }); // pure refund day
    const geo = dailyBurnGeometry(r);
    expect(geo.bars[0].heightPct).toBe(0);
  });
});
