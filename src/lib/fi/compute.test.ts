import { describe, it, expect } from "vitest";
import { fiNumber, projectFI, fiAssetsFromAccounts, recurringAnnualSpend, monthlyContribution } from "./compute";
import { SWR } from "./constants";

describe("fiNumber", () => {
  it("is annual spend divided by the safe withdrawal rate", () => {
    expect(fiNumber(80000, 0.04)).toBe(2_000_000);
  });
  it("uses the 4% default SWR constant", () => {
    expect(SWR).toBe(0.04);
    expect(fiNumber(76000, SWR)).toBe(1_900_000);
  });
  it("returns 0 for non-positive spend", () => {
    expect(fiNumber(0, 0.04)).toBe(0);
    expect(fiNumber(-100, 0.04)).toBe(0);
  });
});

const dob = new Date(Date.UTC(1986, 8, 10));
const now = new Date(Date.UTC(2026, 5, 15)); // 15 Jun 2026

describe("projectFI", () => {
  it("reports reached now when assets already exceed the target", () => {
    const r = projectFI({ startAssets: 200_000, monthlyContribution: 1000, realAnnualReturn: 0.035, fiNumber: 100_000, now, dob });
    expect(r.reached).toBe(true);
    expect(r.months).toBe(0);
  });

  it("counts months for a zero-return contribution-only path (deterministic)", () => {
    const r = projectFI({ startAssets: 0, monthlyContribution: 1000, realAnnualReturn: 0, fiNumber: 12_000, now, dob });
    expect(r.months).toBe(12);
    expect(r.fiDate).toBe("2027-06");
    expect(r.fiAge).toBe(40); // birthday is Sept; not yet 41 in Jun 2027
  });

  it("reaches sooner with a positive real return than without", () => {
    const base = projectFI({ startAssets: 100_000, monthlyContribution: 2000, realAnnualReturn: 0, fiNumber: 500_000, now, dob });
    const withReturn = projectFI({ startAssets: 100_000, monthlyContribution: 2000, realAnnualReturn: 0.05, fiNumber: 500_000, now, dob });
    expect(withReturn.months!).toBeLessThan(base.months!);
    expect(withReturn.reached).toBe(true);
  });

  it("returns not-reached (null) when the gap never closes within the cap", () => {
    const r = projectFI({ startAssets: 1000, monthlyContribution: -100, realAnnualReturn: 0, fiNumber: 2000, now, dob });
    expect(r.reached).toBe(false);
    expect(r.months).toBeNull();
    expect(r.fiDate).toBeNull();
    expect(r.fiAge).toBeNull();
  });
});

describe("fiAssetsFromAccounts", () => {
  it("sums only savings + investment balances", () => {
    const accts = [
      { type: "savings", balance_current: 323.2 },
      { type: "investment", balance_current: 11417.25 },
      { type: "kiwisaver", balance_current: 107327 },
      { type: "checking", balance_current: 114.96 },
      { type: "loan", balance_current: -217000 },
      { type: "other", balance_current: 945000 },
    ];
    expect(fiAssetsFromAccounts(accts)).toBeCloseTo(11740.45, 2);
  });
  it("treats null balances as zero", () => {
    expect(fiAssetsFromAccounts([{ type: "savings", balance_current: null }])).toBe(0);
  });
});

describe("recurringAnnualSpend", () => {
  const txns = [
    { amount: -200, kind: "monthly_cap" },
    { amount: -50, kind: "ap_amortised" },
    { amount: -1210, kind: "transfer" },
    { amount: -300, kind: "reserve" },
    { amount: 2300, kind: "income" },
    { amount: 40, kind: "monthly_cap" },
  ];
  it("sums outflows over recurring kinds only, net of refunds, then annualises a window", () => {
    const annual = recurringAnnualSpend(txns, 30);
    expect(annual).toBeCloseTo(210 * (365 / 30), 2);
  });
});

describe("monthlyContribution", () => {
  const flows = [
    { accountName: "Bonus Saver", amount: 1500 },
    { accountName: "Bonus Saver", amount: -200 },
    { accountName: "Investments", amount: 900 },
  ];
  it("nets deposits minus withdrawals over the window, expressed per month", () => {
    const r = monthlyContribution(flows, 3);
    expect(r.perMonth).toBeCloseTo((1500 - 200 + 900) / 3, 2);
    expect(r.byAccount).toEqual([
      { name: "Bonus Saver", net: 1300 },
      { name: "Investments", net: 900 },
    ]);
  });
});

describe("monthlyContribution with mixed sources", () => {
  it("adds investment-category outflows to account inflows, per month", () => {
    const flows = [
      { accountName: "Westpac Bonus Saver", amount: 300 },
      { accountName: "Westpac Everyday → Investments", amount: 40 },
      { accountName: "Westpac Everyday → Investments", amount: 20 },
    ];
    const r = monthlyContribution(flows, 3);
    expect(r.perMonth).toBeCloseTo((300 + 60) / 3);
    const inv = r.byAccount.find((a) => a.name === "Westpac Everyday → Investments");
    expect(inv?.net).toBe(60);
  });
});

describe("contribution composition (FI-asset inflow + category outflow)", () => {
  it("counts a Sharesies deposit (Investments outflow from checking) as saving", () => {
    const rawFlows = [
      { accountName: "Westpac Bonus Saver", accountType: "savings", categoryName: "", amount: 300 },
      { accountName: "Westpac Everyday", accountType: "checking", categoryName: "Investments", amount: -60 },
      { accountName: "Westpac Everyday", accountType: "checking", categoryName: "Groceries", amount: -200 },
      { accountName: "the owner's Investments", accountType: "investment", categoryName: "Investments", amount: -10 },
    ];
    const FI_ASSET = new Set(["savings", "investment"]);
    const CONTRIB = new Set(["Investments"]);
    const assetInflows = rawFlows.filter((f) => FI_ASSET.has(f.accountType)).map((f) => ({ accountName: f.accountName, amount: f.amount }));
    const categoryOutflows = rawFlows
      .filter((f) => CONTRIB.has(f.categoryName) && !FI_ASSET.has(f.accountType))
      .map((f) => ({ accountName: `${f.accountName} → ${f.categoryName}`, amount: -f.amount }));
    const r = monthlyContribution([...assetInflows, ...categoryOutflows], 3);
    // 300 (saver inflow) + 60 (checking → Investments outflow) − 10 (inflow into
    // the investment account, netted by source 1) = 350 over 3 months.
    expect(r.perMonth).toBeCloseTo(350 / 3);
  });
});

describe("fiAssetsFromAccounts buffer carve-out", () => {
  it("excludes a savings account flagged is_reserve_buffer", () => {
    const accounts = [
      { type: "savings", balance_current: 1000, is_reserve_buffer: false },
      { type: "savings", balance_current: 500, is_reserve_buffer: true }, // buffer
      { type: "investment", balance_current: 2000, is_reserve_buffer: false },
    ];
    expect(fiAssetsFromAccounts(accounts)).toBe(3000); // 1000 + 2000, buffer excluded
  });
  it("treats a missing is_reserve_buffer flag as not-a-buffer", () => {
    expect(fiAssetsFromAccounts([{ type: "savings", balance_current: 100 }])).toBe(100);
  });
});
