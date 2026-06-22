import { describe, it, expect } from "vitest";
import { buildNetWorthSnapshot } from "./snapshot";
import type { NetWorthResult } from "./compute";

const result: NetWorthResult = {
  assets: 1000,
  liabilities: -400,
  net: 600,
  accounts: [
    { name: "Everyday", type: "checking", balance: 1000, isLiability: false },
    { name: "Visa", type: "credit_card", balance: -400, isLiability: true },
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
        { account: "Everyday", type: "checking", balance: 1000 },
        { account: "Visa", type: "credit_card", balance: -400 },
      ],
    });
  });

  it("produces an empty breakdown when there are no accounts", () => {
    const empty: NetWorthResult = { assets: 0, liabilities: 0, net: 0, accounts: [] };
    const row = buildNetWorthSnapshot(empty, { householdId: "hh", snapshotDate: "2026-06-04" });
    expect(row.breakdown).toEqual([]);
  });
});
