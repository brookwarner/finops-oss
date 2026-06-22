import { describe, it, expect } from "vitest";
import { parsePortfolio } from "./parse";

const ctx = { accountId: "acct-uuid", householdId: "hh-uuid" };

describe("parsePortfolio", () => {
  it("maps portfolio entries to holding rows with derived cost_basis", () => {
    const account = {
      meta: {
        portfolio: [
          {
            fund_id: "f1",
            name: "Pathfinder Global Water Fund",
            symbol: "450002",
            logo: "https://logo/1",
            currency: "NZD",
            shares: 151.23,
            value: 514.9,
            returns: 101.97,
          },
        ],
      },
    };
    const rows = parsePortfolio(account, ctx);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      household_id: "hh-uuid",
      account_id: "acct-uuid",
      fund_id: "f1",
      symbol: "450002",
      name: "Pathfinder Global Water Fund",
      logo: "https://logo/1",
      currency: "NZD",
      shares: 151.23,
      value: 514.9,
      returns: 101.97,
      cost_basis: 412.93, // 514.9 - 101.97, rounded to 4dp
    });
  });

  it("returns [] when meta has no portfolio", () => {
    expect(parsePortfolio({ meta: {} }, ctx)).toEqual([]);
    expect(parsePortfolio({ meta: { portfolio: [] } }, ctx)).toEqual([]);
    expect(parsePortfolio({}, ctx)).toEqual([]);
  });

  it("tolerates missing optional fields (symbol/logo/shares)", () => {
    const account = {
      meta: {
        portfolio: [
          { fund_id: "f2", name: "Crypto", currency: "USD", value: 18.89, returns: -1.11 },
        ],
      },
    };
    const rows = parsePortfolio(account, ctx);
    expect(rows[0].symbol).toBeNull();
    expect(rows[0].logo).toBeNull();
    expect(rows[0].shares).toBeNull();
    expect(rows[0].cost_basis).toBe(20);
  });

  it("preserves native currency and does not normalise value", () => {
    const account = {
      meta: { portfolio: [
        { fund_id: "usd1", name: "Gold ETF", currency: "USD", value: 186.83, returns: 21.83 },
      ] },
    };
    const [row] = parsePortfolio(account, ctx);
    expect(row.currency).toBe("USD");
    expect(row.value).toBe(186.83);
    expect(row.cost_basis).toBe(165); // 186.83 - 21.83, native USD
  });
});
