import { describe, it, expect } from "vitest";
import {
  groupHoldings,
  summarisePortfolio,
  type AccountHoldings,
  type AccountRecord,
  type HoldingRecord,
} from "./group";

const accounts: AccountRecord[] = [
  { id: "a1", name: "Sharesies", type: "investment", balance_current: 1200 },
  { id: "a2", name: "KiwiSaver", type: "kiwisaver", balance_current: 42000 },
];

function h(over: Partial<HoldingRecord> & { account_id: string; fund_id: string }): HoldingRecord {
  return {
    symbol: null,
    name: "Fund",
    logo: null,
    currency: "NZD",
    shares: null,
    value: 0,
    returns: 0,
    cost_basis: 0,
    ...over,
  };
}

describe("groupHoldings", () => {
  it("groups funds by account, sorts funds by value desc, and rolls up totals", () => {
    const groups = groupHoldings(
      [
        h({ account_id: "a1", fund_id: "f1", name: "Small", value: 200, returns: 50, cost_basis: 150 }),
        h({ account_id: "a1", fund_id: "f2", name: "Big", value: 1000, returns: 100, cost_basis: 900 }),
      ],
      accounts,
    );
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.accountName).toBe("Sharesies");
    expect(g.holdings.map((x) => x.name)).toEqual(["Big", "Small"]); // value desc
    expect(g.totalValue).toBe(1200);
    expect(g.totalReturn).toBe(150);
    expect(g.totalCost).toBe(1050);
    expect(g.returnPct).toBeCloseTo((150 / 1050) * 100, 5);
    expect(g.balanceNZD).toBe(1200); // authoritative NZD from the account
    expect(g.currency).toBe("NZD");
  });

  it("computes per-fund return percentage against cost basis", () => {
    const [g] = groupHoldings(
      [h({ account_id: "a1", fund_id: "f1", value: 150, returns: 50, cost_basis: 100 })],
      accounts,
    );
    expect(g.holdings[0].returnPct).toBeCloseTo(50, 5);
  });

  it("returns null return% when cost basis is zero", () => {
    const [g] = groupHoldings(
      [h({ account_id: "a1", fund_id: "f1", value: 10, returns: 10, cost_basis: 0 })],
      accounts,
    );
    expect(g.holdings[0].returnPct).toBeNull();
    expect(g.returnPct).toBeNull();
  });

  it("flags a mixed-currency account so native totals can be suppressed", () => {
    const [g] = groupHoldings(
      [
        h({ account_id: "a1", fund_id: "f1", currency: "NZD", value: 100 }),
        h({ account_id: "a1", fund_id: "f2", currency: "USD", value: 80 }),
      ],
      accounts,
    );
    expect(g.currency).toBeNull();
    expect(g.balanceNZD).toBe(1200); // NZD figure stays authoritative
  });

  it("blends per-fund return %s by value for a mixed-currency account", () => {
    const asOf = new Date("2026-06-08");
    const [g] = groupHoldings(
      [
        // NZD fund: +20% over cost, value 120; weight 120
        h({ account_id: "a1", fund_id: "f1", currency: "NZD", value: 120, returns: 20, cost_basis: 100, first_seen: "2024-06-08" }),
        // USD fund: −10% over cost, value 90; weight 90
        h({ account_id: "a1", fund_id: "f2", currency: "USD", value: 90, returns: -10, cost_basis: 100, first_seen: "2024-06-08" }),
      ],
      accounts,
      { asOf },
    );
    expect(g.currency).toBeNull();
    // value-weighted blend: (120*20 + 90*(-10)) / (120+90) = 1500/210 ≈ 7.14%,
    // NOT the dimensionally-muddled native sum (10/200 = 5%).
    expect(g.returnPct).toBeCloseTo(1500 / 210, 4);
    // CAGR derives from the blended fraction over the ~2yr inception, so a
    // mixed-currency account still gets an annualised rate.
    expect(g.annualisedPct).not.toBeNull();
    expect(g.annualisedPct!).toBeCloseTo((Math.pow(1 + 1500 / 210 / 100, 1 / 2) - 1) * 100, 1);
  });

  it("sorts accounts by NZD value, largest first", () => {
    const groups = groupHoldings(
      [
        h({ account_id: "a1", fund_id: "f1", value: 1200 }),
        h({ account_id: "a2", fund_id: "f2", value: 42000 }),
      ],
      accounts,
    );
    expect(groups.map((g) => g.accountName)).toEqual(["KiwiSaver", "Sharesies"]);
  });

  it("falls back gracefully when an account is unknown", () => {
    const [g] = groupHoldings([h({ account_id: "ghost", fund_id: "f1", value: 5 })], accounts);
    expect(g.accountName).toBe("Unknown account");
    expect(g.balanceNZD).toBeNull();
  });
});

describe("groupHoldings — annualised growth", () => {
  const ASOF = new Date(2026, 0, 1); // 1 Jan 2026

  it("annualises off the earliest observed first_seen when all funds are observed", () => {
    const [g] = groupHoldings(
      [
        h({ account_id: "a1", fund_id: "f1", value: 600, returns: 100, cost_basis: 500, first_seen: "2024-01-01", first_seen_observed: true }),
        h({ account_id: "a1", fund_id: "f2", value: 600, returns: 100, cost_basis: 500, first_seen: "2024-06-01", first_seen_observed: true }),
      ],
      accounts,
      { asOf: ASOF },
    );
    expect(g.inception).toBe("2024-01-01");
    expect(g.inceptionSource).toBe("observed");
    // 1000 -> 1200 over ~2y ≈ 9.54%/yr.
    expect(g.annualisedPct).toBeCloseTo(9.54, 1);
    // Each fund annualises off its own observed date.
    expect(g.holdings[0].annualisedPct).not.toBeNull();
  });

  it("does NOT annualise a backfilled holding with no manual seed", () => {
    const [g] = groupHoldings(
      [h({ account_id: "a1", fund_id: "f1", value: 1200, returns: 200, cost_basis: 1000, first_seen: "2026-01-01", first_seen_observed: false })],
      accounts,
      { asOf: ASOF },
    );
    expect(g.inception).toBeNull();
    expect(g.inceptionSource).toBeNull();
    expect(g.annualisedPct).toBeNull();
    expect(g.holdings[0].annualisedPct).toBeNull();
  });

  it("uses the manual investing-since date to seed a backfilled holding", () => {
    const seeded: AccountRecord[] = [
      { id: "a1", name: "Sharesies", type: "investment", balance_current: 1200, investment_inception_date: "2024-01-01" },
    ];
    const [g] = groupHoldings(
      [h({ account_id: "a1", fund_id: "f1", value: 1200, returns: 200, cost_basis: 1000, first_seen: "2026-01-01", first_seen_observed: false })],
      seeded,
      { asOf: ASOF },
    );
    expect(g.inception).toBe("2024-01-01");
    expect(g.inceptionSource).toBe("manual");
    expect(g.annualisedPct).toBeCloseTo(9.54, 1);
  });
});

describe("summarisePortfolio", () => {
  function acct(over: Partial<AccountHoldings>): AccountHoldings {
    return {
      accountId: "a", accountName: "A", accountType: "investment",
      balanceNZD: null, currency: "NZD", totalValue: 0, totalReturn: 0, totalCost: 0,
      returnPct: null, inception: null, inceptionSource: null, heldYears: null,
      annualisedPct: null, holdings: [],
      ...over,
    };
  }

  it("sums NZD value and value-weights the annualised blend", () => {
    const p = summarisePortfolio([
      acct({ balanceNZD: 30000, returnPct: 20, annualisedPct: 6 }),
      acct({ balanceNZD: 10000, returnPct: 40, annualisedPct: 10 }),
    ]);
    expect(p.valueNZD).toBe(40000);
    // (6*30000 + 10*10000) / 40000 = 7.0
    expect(p.annualisedPct).toBeCloseTo(7, 5);
    // (20*30000 + 40*10000) / 40000 = 25.0
    expect(p.returnPct).toBeCloseTo(25, 5);
    expect(p.annualisedCoverageNZD).toBe(40000);
  });

  it("covers only the accounts with an annualised figure", () => {
    const p = summarisePortfolio([
      acct({ balanceNZD: 30000, returnPct: 20, annualisedPct: 8 }),
      acct({ balanceNZD: 10000, returnPct: 40, annualisedPct: null }), // no start date
    ]);
    expect(p.valueNZD).toBe(40000);
    expect(p.annualisedPct).toBeCloseTo(8, 5); // only the 30k account counts
    expect(p.annualisedCoverageNZD).toBe(30000);
  });

  it("returns a null annualised blend when no account has a date", () => {
    const p = summarisePortfolio([acct({ balanceNZD: 5000, returnPct: 10, annualisedPct: null })]);
    expect(p.valueNZD).toBe(5000);
    expect(p.annualisedPct).toBeNull();
    expect(p.annualisedCoverageNZD).toBe(0);
  });

  it("falls back to native total when balanceNZD is absent and skips non-positive weights", () => {
    const p = summarisePortfolio([
      acct({ balanceNZD: null, totalValue: 2000, annualisedPct: 5, returnPct: 5 }),
      acct({ balanceNZD: 0, totalValue: 0, annualisedPct: 99, returnPct: 99 }), // zero weight, ignored
    ]);
    expect(p.valueNZD).toBe(2000);
    expect(p.annualisedPct).toBeCloseTo(5, 5);
  });
});
