import { describe, it, expect } from "vitest";
import { inferIncomeCadence, incomeStreamKey, inferIncomeStreams, type IncomeTxn } from "./events";

function txn(occurred_at: string, amount: number, description?: string): IncomeTxn {
  return { occurred_at, amount, description };
}

describe("inferIncomeCadence", () => {
  it("infers weekly cadence and median amount from regular Friday pay", () => {
    const txns = [
      txn("2026-05-01", 2300), txn("2026-05-08", 2300),
      txn("2026-05-15", 2280), txn("2026-05-22", 2300),
      txn("2026-05-29", 2320),
    ];
    const c = inferIncomeCadence(txns, new Date("2026-06-01"));
    expect(c).not.toBeNull();
    expect(c!.intervalDays).toBe(7);
    expect(c!.amount).toBe(2300); // median
    expect(c!.lastDate.toISOString().slice(0, 10)).toBe("2026-05-29");
  });

  it("returns null with fewer than two income txns", () => {
    expect(inferIncomeCadence([txn("2026-05-29", 2300)], new Date("2026-06-01"))).toBeNull();
    expect(inferIncomeCadence([], new Date("2026-06-01"))).toBeNull();
  });

  it("uses the median interval so a one-off gap does not distort cadence", () => {
    const txns = [
      txn("2026-05-01", 2000), txn("2026-05-08", 2000),
      txn("2026-05-15", 2000), txn("2026-06-05", 2000), // 21-day gap
    ];
    const c = inferIncomeCadence(txns, new Date("2026-06-06"));
    expect(c!.intervalDays).toBe(7); // median of [7,7,21] = 7
  });
});

describe("incomeStreamKey", () => {
  it("groups the same payer despite varying amounts, dates, and case", () => {
    const a = incomeStreamKey("KPMG (NEW ZEALAND) - Example Employer $2,296.66");
    const b = incomeStreamKey("KPMG (New Zealand) - Example Employer 3649.37");
    expect(a).toBe(b);
  });

  it("separates distinct payers", () => {
    expect(incomeStreamKey("KPMG (NEW ZEALAND) - Example Employer"))
      .not.toBe(incomeStreamKey("AUCKLAND KINDERGARTE AKA-WAGES"));
  });

  it("returns a stable empty-ish key for blank descriptions", () => {
    expect(incomeStreamKey(null)).toBe(incomeStreamKey(undefined));
    expect(incomeStreamKey("")).toBe(incomeStreamKey(null));
  });
});

describe("inferIncomeStreams", () => {
  // The real interleaved data that broke the runway: weekly salary, fortnightly
  // wages, and sub-dollar PIE-interest returns all sharing the "income" kind.
  const txns: IncomeTxn[] = [
    txn("2026-05-31", 0.01, "Return $0.01 Less PIE Tax $0.00"),
    txn("2026-05-31", 0.23, "Bonus Return $0.32 Less PIE Tax"),
    txn("2026-05-29", 2296.66, "KPMG (NEW ZEALAND) - Example Employer"),
    txn("2026-05-28", 232.11, "AUCKLAND KINDERGARTE AKA-WAGES"),
    txn("2026-05-22", 2291.15, "KPMG (NEW ZEALAND) - Example Employer"),
    txn("2026-05-15", 2350.14, "KPMG (NEW ZEALAND) - Example Employer"),
    txn("2026-05-14", 232.11, "AUCKLAND KINDERGARTE AKA-WAGES"),
    txn("2026-05-08", 3649.37, "KPMG (NEW ZEALAND) - Example Employer"),
    txn("2026-04-30", 116.12, "AUCKLAND KINDERGARTE AKA-WAGES"),
    txn("2026-04-30", 0.01, "Return $0.01 Less PIE Tax $0.00"),
    txn("2026-04-24", 2186.86, "KPMG (NEW ZEALAND) - Example Employer"),
    txn("2026-04-17", 6645.14, "KPMG (NEW ZEALAND) - Example Employer"),
    txn("2026-04-16", 201.85, "AUCKLAND KINDERGARTE AKA-WAGES"),
  ];

  it("separates the weekly salary and fortnightly wages into distinct cadences", () => {
    const streams = inferIncomeStreams(txns, new Date("2026-06-06"));
    const salary = streams.find((s) => s.amount > 1000);
    const wages = streams.find((s) => s.amount > 50 && s.amount < 1000);
    expect(salary?.intervalDays).toBe(7);
    expect(wages?.intervalDays).toBe(14);
  });

  it("drops sub-floor noise income (PIE-interest micro-returns)", () => {
    const streams = inferIncomeStreams(txns, new Date("2026-06-06"));
    expect(streams.every((s) => s.amount >= 50)).toBe(true);
    expect(streams).toHaveLength(2); // salary + wages only
  });

  it("does NOT collapse to a phantom every-few-days pay (the bug)", () => {
    const streams = inferIncomeStreams(txns, new Date("2026-06-06"));
    expect(streams.every((s) => s.intervalDays >= 7)).toBe(true);
    expect(streams.some((s) => Math.round(s.amount) === 994)).toBe(false);
  });
});

import { projectIncomeEvents } from "./events";

describe("projectIncomeEvents", () => {
  const cadence = { intervalDays: 7, amount: 2300, lastDate: new Date("2026-05-29") };

  it("projects forward from lastDate + interval, inside the horizon only", () => {
    const events = projectIncomeEvents(cadence, null, new Date("2026-06-01"), 30);
    expect(events.map((e) => e.date)).toEqual([
      "2026-06-05", "2026-06-12", "2026-06-19", "2026-06-26",
    ]);
    expect(events.every((e) => e.delta === 2300)).toBe(true);
    expect(events.every((e) => e.kind === "income")).toBe(true);
  });

  it("falls back to a monthly income target when cadence is null", () => {
    const events = projectIncomeEvents(null, { day: 15, amount: 9000 }, new Date("2026-06-01"), 30);
    expect(events.map((e) => e.date)).toEqual(["2026-06-15"]);
    expect(events[0].delta).toBe(9000);
  });

  it("returns nothing when there is neither cadence nor fallback", () => {
    expect(projectIncomeEvents(null, null, new Date("2026-06-01"), 30)).toEqual([]);
  });
});

import { projectCommittedEvents, type CommittedBudget } from "./events";

describe("projectCommittedEvents", () => {
  const budgets: CommittedBudget[] = [
    { categoryId: "mortgage", kind: "ap_amortised", monthlyTarget: 1210, lastActualDay: 21, lastActualAmount: 1225, spendClass: "essential" },
    { categoryId: "rates", kind: "reserve", monthlyTarget: 300, lastActualDay: null, lastActualAmount: null, spendClass: "essential" },
  ];

  it("places one event per month on the last-actual day, using actual amount", () => {
    const events = projectCommittedEvents(budgets, new Date("2026-06-01"), 30);
    const mortgage = events.filter((e) => e.label.includes("mortgage"));
    expect(mortgage).toHaveLength(1);
    expect(mortgage[0].date).toBe("2026-06-21");
    expect(mortgage[0].delta).toBe(-1225);
    expect(mortgage[0].kind).toBe("committed");
  });

  it("falls back to monthly_target and the 1st when no last-actual day", () => {
    const events = projectCommittedEvents(budgets, new Date("2026-06-01"), 30);
    const rates = events.filter((e) => e.label.includes("rates"));
    expect(rates).toHaveLength(1);
    expect(rates[0].date).toBe("2026-06-01");
    expect(rates[0].delta).toBe(-300);
  });

  it("emits a second month's event when the horizon spans it", () => {
    const events = projectCommittedEvents(budgets, new Date("2026-06-01"), 60);
    expect(events.filter((e) => e.label.includes("mortgage")).map((e) => e.date))
      .toEqual(["2026-06-21", "2026-07-21"]);
  });
});

import { projectVariableBurn, projectActualBurn, type ActualCap } from "./events";

describe("projectVariableBurn", () => {
  it("spreads each monthly cap as an equal daily outflow over the horizon", () => {
    const events = projectVariableBurn(
      [{ categoryId: "groceries", monthlyTarget: 2000, spendClass: "essential" }, { categoryId: "dining", monthlyTarget: 1000, spendClass: "discretionary" }],
      30,
      new Date("2026-06-01"),
      3,
    );
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.date)).toEqual(["2026-06-02", "2026-06-03", "2026-06-04"]);
    expect(events.every((e) => e.delta === -100)).toBe(true);
    expect(events.every((e) => e.kind === "variable")).toBe(true);
  });

  it("returns nothing when there are no caps or cycleLength is zero", () => {
    expect(projectVariableBurn([], 30, new Date("2026-06-01"), 5)).toEqual([]);
    expect(projectVariableBurn([{ categoryId: "g", monthlyTarget: 100, spendClass: "essential" }], 0, new Date("2026-06-01"), 5)).toEqual([]);
  });
});

describe("projectActualBurn", () => {
  const now = new Date("2026-06-14T00:00:00Z");
  const caps: ActualCap[] = [
    { categoryId: "groceries", dailyActual: 50, spendClass: "essential" },
    { categoryId: "dining", dailyActual: 50, spendClass: "discretionary" },
  ];

  it("full burn at factor 1 (default): emits one event per day, delta = -(essential + discretionary)", () => {
    const ev = projectActualBurn(caps, now, 5);
    expect(ev).toHaveLength(5);
    expect(ev[0].delta).toBe(-100);
    expect(ev[0].kind).toBe("variable");
    expect(ev.map((e) => e.date)).toEqual([
      "2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19",
    ]);
  });

  it("factor 0 pauses discretionary but keeps essential at full rate", () => {
    const ev = projectActualBurn(caps, now, 3, 0);
    expect(ev).toHaveLength(3);
    expect(ev[0].delta).toBe(-50); // essential $50 only
  });

  it("clamps negative discretionaryFactor to 0 (same as factor 0)", () => {
    const ev = projectActualBurn(caps, now, 3, -2);
    expect(ev).toHaveLength(3);
    expect(ev[0].delta).toBe(-50); // same as factor 0
  });

  it("returns [] when perDay <= 0 (empty caps or all-discretionary with factor 0)", () => {
    const discretionaryOnly: ActualCap[] = [
      { categoryId: "dining", dailyActual: 50, spendClass: "discretionary" },
    ];
    expect(projectActualBurn(discretionaryOnly, now, 3, 0)).toEqual([]);
    expect(projectActualBurn([], now, 3)).toEqual([]);
  });

  it("fractional factor scales discretionary proportionally", () => {
    const ev = projectActualBurn(caps, now, 1, 0.5);
    // essential $50 + 0.5 * discretionary $50 = $75
    expect(ev[0].delta).toBe(-75);
  });
});

import { deriveEvents } from "./events";

describe("deriveEvents", () => {
  it("composes income, committed, and variable events into one sorted list", () => {
    const events = deriveEvents({
      now: new Date("2026-06-01"),
      horizonDays: 30,
      cycleLength: 30,
      incomeTxns: [
        { occurred_at: "2026-05-15", amount: 2300 },
        { occurred_at: "2026-05-22", amount: 2300 },
        { occurred_at: "2026-05-29", amount: 2300 },
      ],
      incomeFallback: null,
      committed: [
        { categoryId: "mortgage", kind: "ap_amortised", monthlyTarget: 1210, lastActualDay: 21, lastActualAmount: 1210, spendClass: "essential" },
      ],
      caps: [{ categoryId: "groceries", monthlyTarget: 3000, spendClass: "essential" }],
    });
    const dates = events.map((e) => e.date);
    expect([...dates]).toEqual([...dates].sort());
    expect(events.some((e) => e.kind === "income")).toBe(true);
    expect(events.some((e) => e.kind === "committed")).toBe(true);
    expect(events.some((e) => e.kind === "variable")).toBe(true);
  });

  it("projects each income stream on its own cadence (no phantom $994/2-day pay)", () => {
    const events = deriveEvents({
      now: new Date("2026-06-06"),
      horizonDays: 30,
      cycleLength: 31,
      incomeTxns: [
        { occurred_at: "2026-05-31", amount: 0.01, description: "Return $0.01 Less PIE Tax" },
        { occurred_at: "2026-05-29", amount: 2296.66, description: "KPMG (NEW ZEALAND) - Example Employer" },
        { occurred_at: "2026-05-28", amount: 232.11, description: "AUCKLAND KINDERGARTE AKA-WAGES" },
        { occurred_at: "2026-05-22", amount: 2291.15, description: "KPMG (NEW ZEALAND) - Example Employer" },
        { occurred_at: "2026-05-15", amount: 2350.14, description: "KPMG (NEW ZEALAND) - Example Employer" },
        { occurred_at: "2026-05-14", amount: 232.11, description: "AUCKLAND KINDERGARTE AKA-WAGES" },
        { occurred_at: "2026-05-08", amount: 3649.37, description: "KPMG (NEW ZEALAND) - Example Employer" },
        { occurred_at: "2026-04-30", amount: 116.12, description: "AUCKLAND KINDERGARTE AKA-WAGES" },
        { occurred_at: "2026-04-24", amount: 2186.86, description: "KPMG (NEW ZEALAND) - Example Employer" },
        { occurred_at: "2026-04-17", amount: 6645.14, description: "KPMG (NEW ZEALAND) - Example Employer" },
        { occurred_at: "2026-04-16", amount: 201.85, description: "AUCKLAND KINDERGARTE AKA-WAGES" },
      ],
      incomeFallback: null,
      committed: [],
      caps: [],
    });
    const incomeDeltas = events.filter((e) => e.kind === "income").map((e) => e.delta);
    // A real ~$2,300 salary lands, a real ~$230 wage lands; none is a $994 phantom.
    expect(incomeDeltas.some((d) => d > 1000)).toBe(true);
    expect(incomeDeltas.some((d) => d > 50 && d < 1000)).toBe(true);
    expect(incomeDeltas.every((d) => Math.round(d) !== 994)).toBe(true);
  });
});

import { nextBillCluster, type ForecastEvent } from "./events";

function bill(date: string, amount: number, name = "x"): ForecastEvent {
  return { date, delta: -Math.abs(amount), label: `bill:${name}`, kind: "committed" };
}

describe("nextBillCluster", () => {
  const now = new Date("2026-06-07");

  it("picks the largest cluster, not the earliest bill", () => {
    const events: ForecastEvent[] = [
      bill("2026-06-27", 18, "Telephone"),       // earlier, tiny
      bill("2026-07-20", 1020, "Rates+Power"),   // big cluster, two days
      bill("2026-07-21", 3654, "Mortgage"),
    ];
    const c = nextBillCluster(events, now);
    expect(c).not.toBeNull();
    expect(c!.date).toBe("2026-07-20");     // cluster START (display anchor)
    expect(c!.endDate).toBe("2026-07-21");  // cluster END (drives cutoff)
    expect(c!.amount).toBe(4674);
    expect(c!.count).toBe(2);
  });

  it("folds bills within the gap into one cluster and splits distant ones", () => {
    const events: ForecastEvent[] = [
      bill("2026-06-20", 1000),
      bill("2026-06-21", 3000),  // gap 1 -> same cluster
      bill("2026-06-27", 18),    // gap 6 -> separate cluster
    ];
    const c = nextBillCluster(events, now);
    expect(c!.date).toBe("2026-06-20");
    expect(c!.endDate).toBe("2026-06-21");
    expect(c!.count).toBe(2);
    expect(c!.amount).toBe(4000);
  });

  it("ignores past bills and income/variable events", () => {
    const events: ForecastEvent[] = [
      bill("2026-06-01", 5000),                                            // past
      { date: "2026-06-20", delta: 2300, label: "Pay", kind: "income" },   // not committed
      { date: "2026-06-20", delta: -50, label: "Daily spend", kind: "variable" },
      bill("2026-06-21", 1210, "Mortgage"),
    ];
    const c = nextBillCluster(events, now);
    expect(c!.date).toBe("2026-06-21");
    expect(c!.amount).toBe(1210);
    expect(c!.count).toBe(1);
  });

  it("returns null when there are no future committed bills", () => {
    const events: ForecastEvent[] = [
      { date: "2026-06-20", delta: 2300, label: "Pay", kind: "income" },
    ];
    expect(nextBillCluster(events, now)).toBeNull();
  });
});
