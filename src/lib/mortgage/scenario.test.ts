import { describe, it, expect } from "vitest";
import { scenarioActive, scenarioPayoffForTranche, simulateScenario, overallMonths, type ScenarioPartInput } from "./scenario";

const NOW = new Date("2026-06-15T00:00:00Z");

describe("scenarioActive", () => {
  it("is false for empty / zero levers", () => {
    expect(scenarioActive(undefined)).toBe(false);
    expect(scenarioActive({})).toBe(false);
    expect(scenarioActive({ extraPerMonth: 0, lumpSum: 0 })).toBe(false);
  });
  it("is true when any lever bites", () => {
    expect(scenarioActive({ extraPerMonth: 50 })).toBe(true);
    expect(scenarioActive({ lumpSum: 1000 })).toBe(true);
    expect(scenarioActive({ refixRate: 5.5 })).toBe(true); // 0 is a real refix rate
    expect(scenarioActive({ refixRate: 0 })).toBe(true);
  });
});

describe("scenarioPayoffForTranche", () => {
  const part: ScenarioPartInput = {
    balance: 100_000,
    monthlyPayment: 2000,
    annualRate: 6, // 0.5%/mo → baseline 58 months
    refixMonths: null,
  };

  it("extra-per-month shortens the loan and saves interest", () => {
    const s = scenarioPayoffForTranche(part, NOW, { extraPerMonth: 500 });
    expect(s.monthsRemaining).not.toBeNull();
    expect(s.monthsRemaining!).toBeLessThan(58);
    expect(s.monthsSaved!).toBeGreaterThan(0);
    expect(s.interestSaved!).toBeGreaterThan(0);
    expect(s.freeDate).toMatch(/^\d{4}-\d{2}$/);
  });

  it("a lump sum reduces the balance before amortising", () => {
    const s = scenarioPayoffForTranche(part, NOW, { lumpSum: 20_000 });
    expect(s.monthsSaved!).toBeGreaterThan(0);
    expect(s.interestSaved!).toBeGreaterThan(0);
  });

  it("no active lever yields zero savings", () => {
    const s = scenarioPayoffForTranche(part, NOW, {});
    expect(s.monthsSaved).toBe(0);
    expect(s.interestSaved).toBe(0);
  });

  it("a lower refix rate (applied immediately when refixMonths is null) saves interest", () => {
    const s = scenarioPayoffForTranche({ ...part, refixMonths: null }, NOW, { refixRate: 4 });
    expect(s.interestSaved!).toBeGreaterThan(0); // 4% < baseline 6% → less interest
    expect(s.monthsRemaining).not.toBeNull();
  });

  it("respects refixMonths — the new rate only applies after the fixed term", () => {
    const immediate = scenarioPayoffForTranche({ ...part, refixMonths: null }, NOW, { refixRate: 4 });
    const deferred = scenarioPayoffForTranche({ ...part, refixMonths: 24 }, NOW, { refixRate: 4 });
    // Refixing sooner (null → applies at month 0) saves at least as much as refixing later.
    expect(immediate.interestSaved!).toBeGreaterThanOrEqual(deferred.interestSaved!);
  });
});

describe("simulateScenario", () => {
  const parts: ScenarioPartInput[] = [
    { balance: 100_000, monthlyPayment: 2000, annualRate: 6, refixMonths: null },
    { balance: 50_000, monthlyPayment: 800, annualRate: 6, refixMonths: null },
  ];

  it("rolls overall payoff up to the latest-clearing tranche", () => {
    const r = simulateScenario(parts, NOW, {});
    const t1 = simulateScenario([parts[0]], NOW, {}).baseMonths!;
    const t2 = simulateScenario([parts[1]], NOW, {}).baseMonths!;
    expect(r.baseMonths).toBe(Math.max(t1, t2));
    expect(r.baseFreeDate).toMatch(/^\d{4}-\d{2}$/);
  });

  it("sums interest saved across tranches and computes months saved", () => {
    const r = simulateScenario(parts, NOW, { extraPerMonth: 300 });
    expect(r.scenMonths!).toBeLessThan(r.baseMonths!);
    expect(r.monthsSaved).toBe(r.baseMonths! - r.scenMonths!);
    expect(r.interestSaved!).toBeGreaterThan(0);
  });

  it("returns null overall months when a tranche never clears", () => {
    const broke: ScenarioPartInput[] = [{ balance: 100_000, monthlyPayment: 100, annualRate: 6, refixMonths: null }];
    expect(simulateScenario(broke, NOW, {}).baseMonths).toBeNull();
  });

  it("ignores zero-balance tranches in the roll-up", () => {
    const mixed: ScenarioPartInput[] = [
      { balance: 0, monthlyPayment: 2000, annualRate: 6, refixMonths: null },
      { balance: 50_000, monthlyPayment: 800, annualRate: 6, refixMonths: null },
    ];
    const r = simulateScenario(mixed, NOW, {});
    expect(r.baseMonths).toBe(simulateScenario([mixed[1]], NOW, {}).baseMonths);
  });

  it("scenario is inactive → scenMonths/interestSaved null", () => {
    const r = simulateScenario(parts, NOW, {});
    expect(r.scenMonths).toBeNull();
    expect(r.interestSaved).toBeNull();
    expect(r.monthsSaved).toBeNull();
  });

  it("no projectable tranches → zero months but no free-date (matches pi.ts's >0 guard)", () => {
    const r = simulateScenario([], NOW, {});
    expect(r.baseMonths).toBe(0);
    expect(r.baseFreeDate).toBeNull();
  });
});

// The single shared roll-up — pi.ts imports and calls this too, so the baseline
// (server) and what-if (client) payoffs can never diverge structurally.
describe("overallMonths", () => {
  it("returns the latest-clearing tranche's months", () => {
    expect(overallMonths([{ balance: 100, months: 30 }, { balance: 100, months: 58 }])).toBe(58);
  });
  it("skips zero/negative-balance tranches", () => {
    expect(overallMonths([{ balance: 0, months: 999 }, { balance: 100, months: 40 }])).toBe(40);
  });
  it("is null if any balance-bearing tranche can't be projected", () => {
    expect(overallMonths([{ balance: 100, months: 40 }, { balance: 100, months: null }])).toBeNull();
  });
  it("a null on a zero-balance tranche is ignored", () => {
    expect(overallMonths([{ balance: 0, months: null }, { balance: 100, months: 40 }])).toBe(40);
  });
  it("empty input → 0", () => {
    expect(overallMonths([])).toBe(0);
  });
});
