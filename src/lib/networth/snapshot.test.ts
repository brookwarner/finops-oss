import { describe, it, expect } from "vitest";
import { buildNetWorthSnapshot, isNZDSnapshot } from "./snapshot";
import type { NetWorthResult } from "./compute";

const result: NetWorthResult = {
  currency: "NZD",
  foreignCurrencies: [],
  assets: 1000,
  liabilities: -400,
  net: 600,
  accounts: [
    { name: "Everyday", type: "checking", balance: 1000, isLiability: false, currency: "NZD" },
    { name: "Visa", type: "credit_card", balance: -400, isLiability: true, currency: "NZD" },
  ],
};

describe("buildNetWorthSnapshot", () => {
  it("shapes totals and per-account breakdown into a snapshot row", () => {
    const row = buildNetWorthSnapshot(result, {
      householdId: "hh-uuid",
      snapshotDate: "2026-06-04",
    });
    expect(row).toEqual({
      household_id: "hh-uuid",
      snapshot_date: "2026-06-04",
      assets: 1000,
      liabilities: -400,
      net: 600,
      breakdown: [
        { account: "Everyday", type: "checking", balance: 1000, currency: "NZD" },
        { account: "Visa", type: "credit_card", balance: -400, currency: "NZD" },
      ],
    });
  });

  it("produces an empty breakdown when there are no accounts", () => {
    const empty: NetWorthResult = { currency: "NZD", foreignCurrencies: [], assets: 0, liabilities: 0, net: 0, accounts: [] };
    const row = buildNetWorthSnapshot(empty, { householdId: "hh", snapshotDate: "2026-06-04" });
    expect(row.breakdown).toEqual([]);
  });
});

it("does not snapshot foreign balances into the NZD trend", () => {
  const row = buildNetWorthSnapshot({ ...result, accounts: [...result.accounts,
    { name: "USD cash", type: "wallet", currency: "USD", balance: 50, isLiability: false }] },
    { householdId: "h1", snapshotDate: "2026-10-21" });
  expect(row.breakdown).toHaveLength(2);
  expect(isNZDSnapshot(row.breakdown)).toBe(true);
  expect(isNZDSnapshot([{ balance: 50 }])).toBe(false);
  expect(isNZDSnapshot([{ currency: "USD", balance: 50 }])).toBe(false);
});
