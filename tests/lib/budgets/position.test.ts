import { describe, it, expect } from "vitest";
import { computePosition, type PositionArgs } from "@/lib/budgets/position";

// period: 20 Jun → 20 Jul, today = day 6 of 30.
const periodStart = new Date("2026-06-20T00:00:00");
const base = { periodStart, dayOfPeriod: 6, periodLength: 30 };

// entries: [id, kind] (name defaults to id) or [id, kind, name].
function kinds(entries: ([string, string] | [string, string, string])[]) {
  const m = new Map<string, { kind: string; group: string | null; name: string }>();
  for (const [id, kind, name] of entries) m.set(id, { kind, group: null, name: name ?? id });
  return m;
}

describe("computePosition", () => {
  it("sums income-kind inflow and expense-kind outflow for the current period", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["inc", "income"], ["food", "monthly_cap"]]),
      budgets: [{ kind: "monthly_cap", monthly_target: 800, name: "Groceries" }],
      txns: [
        { amount: 3000, category_id: "inc", occurred_at: "2026-06-25T00:00:00" },
        { amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" },
      ],
    });
    expect(p.income.actual).toBe(3000);
    expect(p.expenses.actual).toBe(120);
    expect(p.expenses.budget).toBe(800);
    expect(p.net.actual).toBe(2880);
  });

  it("excludes income-kind budgets from the expense-plan benchmark", () => {
    // Income budgets target planned income, not planned spend.
    const p = computePosition({
      ...base,
      categoryKind: kinds([["food", "monthly_cap"], ["inc", "income"]]),
      budgets: [
        { kind: "monthly_cap", monthly_target: 800, name: "Groceries" },
        { kind: "income", monthly_target: 5000, name: "Salary" },
      ],
      txns: [],
    });
    expect(p.expenses.budget).toBe(800);
  });

  it("excludes Mortgage Interest from both the actual Out and the plan benchmark", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([
        ["food", "monthly_cap"],
        ["mortint", "ap_amortised", "Mortgage Interest"],
        ["mortp1", "ap_amortised", "Mortgage Part 1"],
      ]),
      budgets: [
        { kind: "monthly_cap", monthly_target: 800, name: "Groceries" },
        { kind: "ap_amortised", monthly_target: 2700, name: "Mortgage Interest" },
        { kind: "ap_amortised", monthly_target: 1200, name: "Mortgage Part 1" },
      ],
      txns: [
        { amount: -100, category_id: "food", occurred_at: "2026-06-22T00:00:00" },
        { amount: -2787, category_id: "mortint", occurred_at: "2026-06-21T00:00:00" },
        { amount: -1200, category_id: "mortp1", occurred_at: "2026-06-21T00:00:00" },
      ],
    });
    // Interest dropped from Out; principal (Mortgage Part 1) still counts.
    expect(p.expenses.actual).toBe(1300);
    // Benchmark excludes interest (2700) but keeps principal (1200) + Groceries (800).
    expect(p.expenses.budget).toBe(2000);
  });

  it("excludes transfer and system kinds from both sides", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["xfer", "transfer"], ["sys", "system"], ["food", "monthly_cap"]]),
      budgets: [],
      txns: [
        { amount: -700, category_id: "xfer", occurred_at: "2026-06-21T00:00:00" },
        { amount: 700, category_id: "xfer", occurred_at: "2026-06-21T00:00:00" },
        { amount: -40, category_id: "sys", occurred_at: "2026-06-21T00:00:00" },
        { amount: -100, category_id: "food", occurred_at: "2026-06-21T00:00:00" },
      ],
    });
    expect(p.income.actual).toBe(0);
    expect(p.expenses.actual).toBe(100);
  });

  it("nets a refund (positive amount) down within an expense category", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["food", "monthly_cap"]]),
      budgets: [],
      txns: [
        { amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" },
        { amount: 20, category_id: "food", occurred_at: "2026-06-23T00:00:00" },
      ],
    });
    expect(p.expenses.actual).toBe(100);
  });

  it("counts an ap_amortised gross repayment once, ignoring the transfer far leg", () => {
    // Mortgage gross repayment: -1210 leaves the checking account, +1210 credits
    // the loan. Naive netting would zero it out; the gross-leg rule keeps $1,210.
    const p = computePosition({
      ...base,
      categoryKind: kinds([["mortp1", "ap_amortised", "Mortgage Part 1"]]),
      budgets: [{ kind: "ap_amortised", monthly_target: 1210, name: "Mortgage Part 1" }],
      txns: [
        { amount: -1210, category_id: "mortp1", occurred_at: "2026-06-21T00:00:00" }, // checking outflow
        { amount: 1210, category_id: "mortp1", occurred_at: "2026-06-21T00:00:00" },  // loan credit (far leg)
      ],
    });
    expect(p.expenses.actual).toBe(1210);
  });

  it("counts ap_amortised interest as an expense", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["mort", "ap_amortised"]]),
      budgets: [],
      txns: [{ amount: -50, category_id: "mort", occurred_at: "2026-06-21T00:00:00" }],
    });
    expect(p.expenses.actual).toBe(50);
  });

  it("derives expected income from the trailing window when payday hasn't landed", () => {
    // Two prior cycles of income at 3000 each, nothing yet this period.
    const p = computePosition({
      ...base,
      categoryKind: kinds([["inc", "income"]]),
      budgets: [],
      txns: [
        { amount: 3000, category_id: "inc", occurred_at: "2026-04-25T00:00:00" },
        { amount: 3000, category_id: "inc", occurred_at: "2026-05-25T00:00:00" },
      ],
    });
    expect(p.income.actual).toBe(0);
    // trailing 6000 / ROLLING_PERIODS(3) = 2000
    expect(p.income.expected).toBe(2000);
  });

  it("expected income snaps to actual once it exceeds the trailing average", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["inc", "income"]]),
      budgets: [],
      txns: [
        { amount: 3000, category_id: "inc", occurred_at: "2026-05-25T00:00:00" }, // trailing avg = 1000
        { amount: 3200, category_id: "inc", occurred_at: "2026-06-25T00:00:00" }, // actual this period
      ],
    });
    expect(p.income.actual).toBe(3200);
    expect(p.income.expected).toBe(3200); // max(3200, 1000)
  });

  it("projects expenses at the run-rate", () => {
    const p = computePosition({
      ...base, // day 6 of 30
      categoryKind: kinds([["food", "monthly_cap"]]),
      budgets: [],
      txns: [{ amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" }],
    });
    // 120 / 6 * 30 = 600
    expect(p.expenses.projected).toBe(600);
  });

  it("does NOT run-rate a committed ap_amortised bill that has already posted", () => {
    const p = computePosition({
      ...base, // day 6 of 30
      categoryKind: kinds([["food", "monthly_cap"], ["mort", "ap_amortised", "Mortgage Part 1"]]),
      budgets: [{ kind: "ap_amortised", monthly_target: 3000, name: "Mortgage Part 1" }],
      txns: [
        { amount: -60, category_id: "food", occurred_at: "2026-06-22T00:00:00" },   // variable → run-rated
        { amount: -3000, category_id: "mort", occurred_at: "2026-06-21T00:00:00" }, // committed lump
      ],
    });
    // variable: 60/6*30 = 300; committed: max(3000 posted, 3000 budget) = 3000 (NOT 3000/6*30).
    expect(p.expenses.projected).toBe(3300);
  });

  it("projects an unpaid committed bill at its budget", () => {
    const p = computePosition({
      ...base, // day 6 of 30
      categoryKind: kinds([["food", "monthly_cap"], ["mort", "ap_amortised", "Mortgage Part 1"]]),
      budgets: [{ kind: "ap_amortised", monthly_target: 3000, name: "Mortgage Part 1" }],
      txns: [{ amount: -60, category_id: "food", occurred_at: "2026-06-22T00:00:00" }],
    });
    // committed not yet posted → projected at budget 3000; variable 60/6*30 = 300.
    expect(p.expenses.projected).toBe(3300);
  });

  it("guards against dayOfPeriod = 0 (projected falls back to actual)", () => {
    const p = computePosition({
      periodStart, dayOfPeriod: 0, periodLength: 30,
      categoryKind: kinds([["food", "monthly_cap"]]),
      budgets: [],
      txns: [{ amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" }],
    });
    expect(p.expenses.projected).toBe(120);
  });

  it("computes net.planned as Σ income budgets − Σ expense budgets (structural, txn-independent)", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["inc", "income"], ["food", "monthly_cap"], ["fun", "monthly_cap"]]),
      budgets: [
        { kind: "income", monthly_target: 5000, name: "Salary" },
        { kind: "monthly_cap", monthly_target: 800, name: "Groceries" },
        { kind: "monthly_cap", monthly_target: 300, name: "Fun" },
      ],
      txns: [], // no transactions — structural figure must not depend on them
    });
    // plannedIncome 5000 − plannedExpenses (800 + 300) = 3900
    expect(p.net.planned).toBe(3900);
  });

  it("net.planned goes negative when budget caps exceed planned income (over-committed)", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["inc", "income"], ["food", "monthly_cap"]]),
      budgets: [
        { kind: "income", monthly_target: 1000, name: "Salary" },
        { kind: "monthly_cap", monthly_target: 1500, name: "Groceries" },
      ],
      txns: [],
    });
    expect(p.net.planned).toBe(-500);
  });

  it("computes net.projected from expected income minus projected expenses", () => {
    const p = computePosition({
      ...base, // day 6 of 30
      categoryKind: kinds([["inc", "income"], ["food", "monthly_cap"]]),
      budgets: [],
      txns: [
        { amount: 2400, category_id: "inc", occurred_at: "2026-06-25T00:00:00" }, // expected = 2400
        { amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" }, // projected = 600
      ],
    });
    expect(p.net.projected).toBe(1800);
  });

  it("folds pendingOutflow into projected as a flat committed addition (not run-rated)", () => {
    const p = computePosition({
      ...base, // day 6 of 30
      categoryKind: kinds([["food", "monthly_cap"]]),
      budgets: [],
      txns: [{ amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" }],
      pendingOutflow: 50,
    });
    // variable 120/6*30 = 600, plus pending 50 added flat (already incurred, not multiplied).
    expect(p.expenses.projected).toBe(650);
    expect(p.expenses.pending).toBe(50);
    // Settled-only actual is unchanged — pending never inflates the audited figure.
    expect(p.expenses.actual).toBe(120);
  });

  it("defaults expenses.pending to 0 when no pendingOutflow is supplied", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["food", "monthly_cap"]]),
      budgets: [],
      txns: [{ amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" }],
    });
    expect(p.expenses.pending).toBe(0);
    expect(p.expenses.projected).toBe(600);
  });

  it("reduces net.projected by the pending outflow", () => {
    const p = computePosition({
      ...base, // day 6 of 30
      categoryKind: kinds([["inc", "income"], ["food", "monthly_cap"]]),
      budgets: [],
      txns: [
        { amount: 2400, category_id: "inc", occurred_at: "2026-06-25T00:00:00" }, // expected = 2400
        { amount: -120, category_id: "food", occurred_at: "2026-06-22T00:00:00" }, // projected = 600
      ],
      pendingOutflow: 50,
    });
    // 2400 − (600 + 50) = 1750
    expect(p.net.projected).toBe(1750);
  });

  it("ignores txns whose category is not in the map", () => {
    const p = computePosition({
      ...base,
      categoryKind: kinds([["food", "monthly_cap"]]),
      budgets: [],
      txns: [
        { amount: -100, category_id: "food", occurred_at: "2026-06-21T00:00:00" },
        { amount: -999, category_id: "unknown", occurred_at: "2026-06-21T00:00:00" },
      ],
    });
    expect(p.expenses.actual).toBe(100);
  });
});

describe("computePosition income anchoring", () => {
  // ROLLING_PERIODS is 3. Prior-window income of 29,598.64 → trailing avg 9,866.21.
  // Plan = Salary 10,600 + Partner 550 + Other 105 + Interest 15 = 11,270.
  function baseArgs(overrides: Partial<PositionArgs> = {}): PositionArgs {
    const categoryKind = new Map([
      ["inc", { kind: "income", group: null, name: "Salary" }],
      ["gro", { kind: "monthly_cap", group: "Food", name: "Groceries" }],
    ]);
    return {
      txns: [
        // current cycle income (on/after periodStart)
        { amount: 7349.35, category_id: "inc", occurred_at: "2026-06-06" },
        // prior-window income (before periodStart): three cycles summing 29,598.64
        { amount: 11958.73, category_id: "inc", occurred_at: "2026-03-19" },
        { amount: 7441.03, category_id: "inc", occurred_at: "2026-04-17" },
        { amount: 10198.88, category_id: "inc", occurred_at: "2026-05-08" },
      ],
      categoryKind,
      budgets: [
        { kind: "income", monthly_target: 10600, name: "Salary" },
        { kind: "income", monthly_target: 550, name: "Partner ECE Income" },
        { kind: "income", monthly_target: 105, name: "Other Income" },
        { kind: "income", monthly_target: 15, name: "Interest Income" },
      ],
      periodStart: new Date("2026-05-20T00:00:00Z"),
      dayOfPeriod: 18,
      periodLength: 31,
      ...overrides,
    };
  }

  it("anchors the pace marker to the plan, not the trailing average", () => {
    const p = computePosition(baseArgs());
    // 11,270 × (18/31) = 6,543.87 — NOT the trailing-avg-based 9,866 × 18/31 = 5,729
    expect(p.income.expectedByNow).toBeCloseTo(6543.87, 1);
    expect(p.income.planned).toBe(11270);
  });

  it("carries the trailing 3-cycle average as recentRunRate even when a plan exists", () => {
    const p = computePosition(baseArgs());
    expect(p.income.recentRunRate).toBeCloseTo(9866.21, 1);
  });

  it("full-cycle expected is max(actual, planned)", () => {
    // actual 7,349 < plan 11,270 → expected = plan
    expect(computePosition(baseArgs()).income.expected).toBe(11270);
    // actual above plan wins
    const hot = computePosition(
      baseArgs({
        txns: [{ amount: 12000, category_id: "inc", occurred_at: "2026-06-06" }],
      }),
    );
    expect(hot.income.expected).toBe(12000);
  });

  it("falls back to recentRunRate when no income budgets are set", () => {
    const p = computePosition(baseArgs({ budgets: [] }));
    expect(p.income.planned).toBe(0);
    // expectedByNow uses recentRunRate: 9,866.21 × 18/31 = 5,728.77
    expect(p.income.expectedByNow).toBeCloseTo(5728.77, 1);
    // expected = max(actual, recentRunRate) = 9,866.21
    expect(p.income.expected).toBeCloseTo(9866.21, 1);
  });
});

// Self-heal tests use a different base (different periodStart) to keep txns cleanly prior.
const selfHealBase = {
  periodStart: new Date("2026-05-20T00:00:00Z"),
  dayOfPeriod: 10,
  periodLength: 30,
};

function kindMap(entries: [string, string, string][]) {
  return new Map(entries.map(([id, k, name]) => [id, { kind: k, group: null as string | null, name }]));
}

describe("computePosition — committed self-heal", () => {
  it("reserves an unbudgeted recurring ap_amortised bill in the projection floor", () => {
    const txns = [
      { amount: -250, category_id: "caravan", occurred_at: "2026-04-08T00:00:00Z" },
      { amount: -250, category_id: "caravan", occurred_at: "2026-03-08T00:00:00Z" },
      { amount: -250, category_id: "caravan", occurred_at: "2026-02-08T00:00:00Z" },
      { amount: 5000, category_id: "salary", occurred_at: "2026-05-25T00:00:00Z" },
    ];
    const categoryKind = kindMap([["caravan", "ap_amortised", "Caravan Repayments"], ["salary", "income", "Salary"]]);
    const withHeal = computePosition({ ...selfHealBase, txns, categoryKind, budgets: [] });
    expect(withHeal.expenses.projected).toBeGreaterThanOrEqual(250);
  });

  it("does NOT inject Mortgage Interest (excluded) into the floor", () => {
    const txns = [
      { amount: -2700, category_id: "mi", occurred_at: "2026-04-08T00:00:00Z" },
      { amount: -2700, category_id: "mi", occurred_at: "2026-03-08T00:00:00Z" },
    ];
    const categoryKind = kindMap([["mi", "ap_amortised", "Mortgage Interest"]]);
    const pos = computePosition({ ...selfHealBase, txns, categoryKind, budgets: [] });
    expect(pos.expenses.projected).toBe(0);
  });

  it("ignores a one-off unbudgeted ap outflow", () => {
    const txns = [{ amount: -900, category_id: "oneoff", occurred_at: "2026-04-08T00:00:00Z" }];
    const categoryKind = kindMap([["oneoff", "ap_amortised", "One Off"]]);
    const pos = computePosition({ ...selfHealBase, txns, categoryKind, budgets: [] });
    expect(pos.expenses.projected).toBe(0);
  });

  it("does NOT shadow a recurring ap that already has a budget row", () => {
    const txns = [
      { amount: -250, category_id: "caravan", occurred_at: "2026-04-08T00:00:00Z" },
      { amount: -250, category_id: "caravan", occurred_at: "2026-03-08T00:00:00Z" },
    ];
    const categoryKind = kindMap([["caravan", "ap_amortised", "Caravan Repayments"]]);
    // Budget present (target 250) → committedBudget covers it; shadow must not
    // double-reserve. Floor is max(committedActual=0, committedBudget=250 + shadow=0).
    const pos = computePosition({
      ...selfHealBase, txns, categoryKind,
      budgets: [{ kind: "ap_amortised", monthly_target: 250, name: "Caravan Repayments", categoryId: "caravan" }],
    });
    expect(pos.expenses.projected).toBe(250);
  });
});
