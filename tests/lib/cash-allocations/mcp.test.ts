import { beforeEach, expect, it, vi } from "vitest";
const { load, save, compute, invalidate } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), compute: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/cache/household", () => ({ revalidateHousehold: invalidate }));
vi.mock("@/lib/cash-allocations/store", () => ({ loadCashAvailability: load, saveCashAllocation: save }));
vi.mock("@/lib/cashflow/compute", () => ({ computeCashflow: compute }));
import { cashAllocationTools } from "@/lib/mcp/tools/cash-allocations";
import { cashflowTools } from "@/lib/mcp/tools/cashflow";
const extra = { authInfo: { extra: { householdId: "household-a" } } };
const config = { accountId: "e36e4e59-4608-4da9-9806-7fb89b43d0bb", revision: 2, businessCash: true, wholeAccountLabel: null, pots: [] };
beforeEach(() => { vi.clearAllMocks(); });
it("returns availability as a JSON object, scoped to authenticated household", async () => {
  const state = { accounts: [], business: { availableToDraw: 6000 }, totalProtected: 14000 };
  load.mockResolvedValue(state);
  const r = await cashAllocationTools[0].handler({}, extra);
  expect(JSON.parse(r.content[0].text)).toEqual(state);
  expect(load).toHaveBeenCalledWith({}, "household-a");
});
it("saves the parsed plan and returns its new revision as an object", async () => {
  save.mockResolvedValue({ ...config, revision: 3 });
  const r = await cashAllocationTools[1].handler(config, extra);
  expect(JSON.parse(r.content[0].text)).toEqual({ config: { ...config, revision: 3 } });
  expect(save).toHaveBeenCalledWith({}, "household-a", config);
  expect(invalidate).toHaveBeenCalledWith("household-a");
});
it("preserves the protected-cash context in the compact cashflow summary", async () => {
  compute.mockResolvedValue({ startLiquid: 6000, creditHeadroom: 0, inflows: [], nextBills: null, verdict: { makesIt: true }, lines: [], context: { cashProtected: 14000 } });
  const r = await cashflowTools[0].handler({}, extra);
  expect(JSON.parse(r.content[0].text).context.cashProtected).toBe(14000);
});
