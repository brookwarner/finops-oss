import { describe, expect, it } from "vitest";
import { computeCashAvailability, protectionInAccounts, type CashAccount } from "@/lib/cash-allocations/compute";
import { cashAllocationSchema, type CashAllocationConfig } from "@/lib/cash-allocations/contract";
import { buildLines, type BuildLinesArgs } from "@/lib/cashflow/engine";
import { fiAssetsFromAccounts } from "@/lib/fi/compute";

const id = "e36e4e59-4608-4da9-9806-7fb89b43d0bb";
const account = (over: Partial<CashAccount> = {}): CashAccount => ({ id, name: "Business", type: "checking", currency: "NZD", balance_current: 20000,
  akahu_account_id: "acc_business", akahu_status: "ACTIVE", is_reserve_buffer: false, is_emergency_fund: false, refreshed_balance_at: null, ...over });
const config = (over: Partial<CashAllocationConfig> = {}): CashAllocationConfig => ({ accountId: id, revision: 1, businessCash: true, wholeAccountLabel: null,
  pots: [{ label: "GST", amount: 2000 }, { label: "Income tax", amount: 4000 }, { label: "Costs", amount: 3000 }, { label: "Buffer", amount: 5000 }], ...over });

describe("cash available after allocations", () => {
  it("computes the agreed business draw example from received cash", () => {
    const s = computeCashAvailability([account()], [config()]);
    expect(s.business).toEqual({ configured: true, cash: 20000, protected: 14000, availableToDraw: 6000, shortfall: 0 });
  });
  it("has no assumed business pool or tax allocation before configuration", () => {
    expect(computeCashAvailability([account()], []).business).toEqual({ configured: false, cash: 0, protected: 0, availableToDraw: 0, shortfall: 0 });
  });
  it("preserves obligations when cash falls short and prevents a negative drawing", () => {
    const s = computeCashAvailability([account({ balance_current: 10000 })], [config()]);
    expect(s.business.availableToDraw).toBe(0); expect(s.business.shortfall).toBe(4000);
    expect(s.accounts[0].unallocated).toBe(-4000);
  });
  it("protects a dedicated account once even if old manual allocations remain", () => {
    const s = computeCashAvailability([account({ is_reserve_buffer: true })], [config()]);
    expect(s.totalProtected).toBe(20000); expect(s.business.availableToDraw).toBe(0);
  });
  it("tracks whole-account protection as balances change, preserving overdrafts", () => {
    const c = config({ wholeAccountLabel: "Tax", pots: [] });
    expect(computeCashAvailability([account({ balance_current: 2000 })], [c]).totalProtected).toBe(2000);
    const s = computeCashAvailability([account({ balance_current: -400 })], [c]);
    expect(s.totalProtected).toBe(0); expect(s.business.shortfall).toBe(400);
  });
  it("nets business overdrafts and excludes personal accounts from drawings", () => {
    const s = computeCashAvailability([account({ balance_current: 1000 }), account({ id: "overdraft", balance_current: -200 }), account({ id: "personal", balance_current: 30000 })],
      [config({ pots: [] }), config({ accountId: "overdraft", pots: [] })]);
    expect(s.business.availableToDraw).toBe(800);
    expect(protectionInAccounts(s, new Set(["personal"]))).toBe(0);
  });
  it("deducts only allocations inside each view's actual account pool", () => {
    const s = computeCashAvailability([account(), account({ id: "tax", balance_current: 2000 })], [config(), config({ accountId: "tax", wholeAccountLabel: "Tax", pots: [] })]);
    expect(protectionInAccounts(s, new Set([id]))).toBe(14000);
    expect(protectionInAccounts(s, new Set([id, "tax"]))).toBe(16000);
  });
  it("works in cents without floating point residue", () => {
    const s = computeCashAvailability([account({ balance_current: 0.3 })], [config({ pots: [{ label: "One", amount: 0.1 }, { label: "Two", amount: 0.2 }] })]);
    expect(s.business.availableToDraw).toBe(0); expect(s.business.shortfall).toBe(0);
  });
  it("fails visibly on missing balances and incompatible saved account plans", () => {
    expect(computeCashAvailability([account({ balance_current: null })], [config()]).business.availableToDraw).toBeNull();
    expect(computeCashAvailability([account({ currency: "USD" })], [config()]).issues[0]).toContain("no longer NZD cash");
    expect(computeCashAvailability([account({ akahu_status: "INACTIVE", balance_current: null })], []).accounts).toHaveLength(0);
  });
  it("releasing a paid obligation changes availability, never the bank balance", () => {
    const s = computeCashAvailability([account({ balance_current: 16000 })], [config({ pots: config().pots.filter((p) => p.label !== "Income tax") })]);
    expect(s.business.cash).toBe(16000); expect(s.business.availableToDraw).toBe(6000);
  });
});

it("rejects invalid money, ambiguous protection and household injection", () => {
  for (const c of [config({ pots: [{ label: "Tax", amount: -1 }] }), config({ pots: [{ label: "Tax", amount: 0.001 }] }),
    config({ wholeAccountLabel: "Tax" }), { ...config(), householdId: "other" }]) expect(cashAllocationSchema.safeParse(c).success).toBe(false);
});

it("all cashflow scenarios start after protection and keep their explanation on recompute", () => {
  const s = computeCashAvailability([account()], [config()]);
  const args: BuildLinesArgs = { now: new Date("2026-10-10T00:00:00Z"), horizonDays: 2, startLiquid: 20000 - s.totalProtected, cashProtected: s.totalProtected,
    cycleLength: 30, incomeTxns: [], incomeFallback: null, actualCaps: [], budgetCaps: [], committed: [], toggles: {}, inflows: [], receivables: 0, creditHeadroom: 0 };
  const r = buildLines(args);
  expect(r.lines.every((l) => l.series[0].balance === 6000)).toBe(true);
  expect(r.context.cashProtected).toBe(14000);
});

it("carves protected savings out of FI while retaining investment assets", () => {
  expect(fiAssetsFromAccounts([{ type: "savings", balance_current: 10000, cashProtected: 3000 }, { type: "investment", balance_current: 20000 }])).toBe(27000);
  expect(fiAssetsFromAccounts([{ type: "savings", balance_current: 100, cashProtected: 1000 }])).toBe(0);
});
