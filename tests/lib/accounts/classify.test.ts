import { describe, it, expect } from "vitest";
import { LIQUID_ACCOUNT_TYPES, creditHeadroom, isRevolvingFacility } from "@/lib/accounts/classify";

type Acct = { type: string; is_revolving_facility?: boolean | null; balance_current: number | null; balance_available: number | null };

describe("LIQUID_ACCOUNT_TYPES", () => {
  it("counts spendable cash types and excludes investments/loans/credit", () => {
    for (const t of ["checking", "savings", "wallet"]) expect(LIQUID_ACCOUNT_TYPES.has(t)).toBe(true);
    for (const t of ["investment", "kiwisaver", "loan", "credit", "other"]) {
      expect(LIQUID_ACCOUNT_TYPES.has(t)).toBe(false);
    }
  });
});

describe("isRevolvingFacility", () => {
  it("reads the is_revolving_facility flag", () => {
    expect(isRevolvingFacility({ is_revolving_facility: true })).toBe(true);
    expect(isRevolvingFacility({ is_revolving_facility: false })).toBe(false);
    expect(isRevolvingFacility({ is_revolving_facility: null })).toBe(false);
    expect(isRevolvingFacility({})).toBe(false);
  });
});

describe("creditHeadroom", () => {
  it("sums flagged-facility available + everyday overdraft headroom", () => {
    const accts: Acct[] = [
      { type: "loan", is_revolving_facility: true, balance_current: -13139, balance_available: 36861 },
      { type: "checking", balance_current: 98, balance_available: 598 },
      { type: "savings", balance_current: 323, balance_available: 323 },
      { type: "savings", balance_current: 5, balance_available: null },
    ];
    expect(creditHeadroom(accts)).toBe(37361);
  });
  it("sums multiple flagged facilities", () => {
    const accts: Acct[] = [
      { type: "loan", is_revolving_facility: true, balance_current: -100, balance_available: 1000 },
      { type: "loan", is_revolving_facility: true, balance_current: -100, balance_available: 500 },
    ];
    expect(creditHeadroom(accts)).toBe(1500);
  });
  it("clamps negatives and ignores non-liquid non-revolving loans", () => {
    const accts: Acct[] = [
      { type: "loan", is_revolving_facility: false, balance_current: -217000, balance_available: null },
      { type: "checking", balance_current: 200, balance_available: 100 },
    ];
    expect(creditHeadroom(accts)).toBe(0);
  });
  it("returns 0 for no accounts", () => {
    expect(creditHeadroom([])).toBe(0);
  });
});
