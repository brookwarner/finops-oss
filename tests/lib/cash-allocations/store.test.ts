import { beforeEach, expect, it, vi } from "vitest";
const { scope, accounts, plans } = vi.hoisted(() => ({ scope: vi.fn(), accounts: vi.fn(), plans: vi.fn() }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedDb: scope }));
import { saveCashAllocation, loadCashAllocationConfigs, CashAllocationConflict, InvalidCashAllocation } from "@/lib/cash-allocations/store";

const input = { accountId: "e36e4e59-4608-4da9-9806-7fb89b43d0bb", revision: 2, businessCash: true, wholeAccountLabel: null, pots: [{ label: "Tax", amount: 1000 }] };
const eq = vi.fn();
const update = vi.fn();
const insert = vi.fn();
let account: any;
let result: any;
beforeEach(() => {
  vi.clearAllMocks();
  account = { id: input.accountId, type: "checking", currency: "NZD", balance_current: 2000, akahu_status: "ACTIVE", is_reserve_buffer: false, is_emergency_fund: false };
  result = { data: { account_id: input.accountId }, error: null };
  const readBuilder = { eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: account, error: null }) };
  const writeBuilder = { eq, select: vi.fn().mockReturnThis(), single: async () => result, maybeSingle: async () => result };
  eq.mockReturnValue(writeBuilder); update.mockReturnValue(writeBuilder); insert.mockReturnValue(writeBuilder);
  accounts.mockReturnValue(readBuilder);
  plans.mockResolvedValue([]);
  scope.mockReturnValue({ accounts: { select: accounts }, cash_allocations: { update, insert, selectAllPaged: plans } });
});
it("binds reads and updates to authenticated household and current revision", async () => {
  expect(await saveCashAllocation({} as any, "household-a", input)).toEqual({ ...input, revision: 3 });
  expect(scope).toHaveBeenCalledWith({}, "household-a");
  expect(eq).toHaveBeenCalledWith("account_id", input.accountId);
  expect(eq).toHaveBeenCalledWith("revision", 2);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ revision: 3, pots: input.pots }));
});
it("does not overwrite a concurrent edit or first insert", async () => {
  result = { data: null, error: null };
  await expect(saveCashAllocation({} as any, "a", input)).rejects.toBeInstanceOf(CashAllocationConflict);
  result = { data: null, error: { code: "23505" } };
  await expect(saveCashAllocation({} as any, "a", { ...input, revision: null })).rejects.toBeInstanceOf(CashAllocationConflict);
});
it("rejects an account outside the household before mutation", async () => {
  account = null;
  await expect(saveCashAllocation({} as any, "a", input)).rejects.toBeInstanceOf(InvalidCashAllocation);
  expect(update).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
});
it("rejects incompatible currency, and overlapping reserve/emergency protection", async () => {
  for (const extra of [{ currency: "USD" }, { is_reserve_buffer: true }, { is_emergency_fund: true }]) {
    account = { ...account, ...extra };
    await expect(saveCashAllocation({} as any, "a", input)).rejects.toBeInstanceOf(InvalidCashAllocation);
  }
  expect(update).not.toHaveBeenCalled();
});
it("allows clearing a stale plan after its account changed type", async () => {
  account = { ...account, type: "investment" };
  await saveCashAllocation({} as any, "a", { ...input, businessCash: false, pots: [] });
  expect(update).toHaveBeenCalled();
});
it("surfaces corrupt stored amounts rather than assuming zero protection", async () => {
  plans.mockResolvedValue([{ account_id: input.accountId, revision: 1, business_cash: true, whole_account_label: null, pots: [{ label: "Tax", amount: -10 }] }]);
  await expect(loadCashAllocationConfigs({} as any, "a")).rejects.toThrow();
});
