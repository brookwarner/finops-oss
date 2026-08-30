import { describe, it, expect } from "vitest";
import { shapeBalances, type BalanceAccountRow } from "@/lib/accounts/balances";

function row(over: Partial<BalanceAccountRow> = {}): BalanceAccountRow {
  return {
    akahu_account_id: "acc_1",
    name: "Everyday",
    institution: "Westpac",
    type: "checking",
    balance_current: 100,
    currency: "NZD",
    show_on_dashboard: true,
    akahu_status: "ACTIVE",
    ...over,
  };
}

describe("shapeBalances", () => {
  it("keeps active Akahu accounts and manual assets, drops dead connections", () => {
    const r = shapeBalances([
      row({ akahu_account_id: "acc_live" }),
      row({ akahu_account_id: "acc_dead", akahu_status: "INACTIVE" }),
      row({ akahu_account_id: "manual_home", akahu_status: null, balance_current: 940000 }),
    ]);
    expect(r.accounts.map((a) => a.akahuAccountId)).toEqual(["manual_home", "acc_live"]);
  });

  it("classifies liabilities by balance sign, not account type", () => {
    const r = shapeBalances([
      row({ akahu_account_id: "loan_as_checking", type: "checking", balance_current: -500 }),
    ]);
    expect(r.accounts[0].isLiability).toBe(true);
  });

  it("orders assets before liabilities, each largest-magnitude first", () => {
    const r = shapeBalances([
      row({ akahu_account_id: "a_small", balance_current: 10 }),
      row({ akahu_account_id: "l_big", balance_current: -900 }),
      row({ akahu_account_id: "a_big", balance_current: 500 }),
      row({ akahu_account_id: "l_small", balance_current: -20 }),
    ]);
    expect(r.accounts.map((a) => a.akahuAccountId)).toEqual([
      "a_big",
      "a_small",
      "l_big",
      "l_small",
    ]);
  });

  it("totals only the shown accounts, signed so liabilities subtract", () => {
    const r = shapeBalances([
      row({ akahu_account_id: "a", balance_current: 1000 }),
      row({ akahu_account_id: "b", balance_current: -250 }),
      row({ akahu_account_id: "hidden", balance_current: 9999, show_on_dashboard: false }),
    ]);
    expect(r.shownTotal).toBe(750);
    expect(r.shownCount).toBe(2);
    expect(r.hiddenCount).toBe(1);
    // Hidden accounts still come back — edit mode has to list them.
    expect(r.accounts).toHaveLength(3);
  });

  it("defaults a never-configured account to shown", () => {
    const r = shapeBalances([row({ show_on_dashboard: null })]);
    expect(r.accounts[0].shown).toBe(true);
  });

  it("treats a null balance as zero and trims stray whitespace in labels", () => {
    const r = shapeBalances([
      row({ balance_current: null, name: "Discretionary ", institution: " TSB" }),
    ]);
    expect(r.accounts[0].balance).toBe(0);
    expect(r.accounts[0].name).toBe("Discretionary");
    expect(r.accounts[0].institution).toBe("TSB");
  });

  it("marks a revolving facility and carries its undrawn headroom", () => {
    const r = shapeBalances([
      row({
        akahu_account_id: "choices_everyday",
        name: "Choices Everyday",
        type: "loan",
        balance_current: 0,
        balance_available: 50000,
        is_revolving_facility: true,
      }),
    ]);
    expect(r.accounts[0].isRevolving).toBe(true);
    expect(r.accounts[0].available).toBe(50000);
    // Undrawn reads $0 and is NOT a liability — nothing is owed yet.
    expect(r.accounts[0].isLiability).toBe(false);
  });

  it("leaves headroom null on ordinary accounts, even with an available balance", () => {
    const r = shapeBalances([row({ balance_available: 684.57 })]);
    expect(r.accounts[0].isRevolving).toBe(false);
    expect(r.accounts[0].available).toBeNull();
  });

  it("counts a drawn facility as a liability at the drawn amount", () => {
    const r = shapeBalances([
      row({
        akahu_account_id: "drawn",
        balance_current: -12000,
        balance_available: 38000,
        is_revolving_facility: true,
      }),
    ]);
    expect(r.accounts[0].isLiability).toBe(true);
    expect(r.shownTotal).toBe(-12000);
  });

  it("rounds the total to cents rather than carrying float drift", () => {
    const r = shapeBalances([
      row({ akahu_account_id: "a", balance_current: 0.1 }),
      row({ akahu_account_id: "b", balance_current: 0.2 }),
    ]);
    expect(r.shownTotal).toBe(0.3);
  });
});
