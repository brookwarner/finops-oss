import { beforeEach, expect, it, vi } from "vitest";
const { identity, load, save, invalidate } = vi.hoisted(() => ({ identity: vi.fn(), load: vi.fn(), save: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/api/identity", () => ({ resolveIdentity: identity }));
vi.mock("@/lib/cache/household", () => ({ revalidateHousehold: invalidate }));
vi.mock("@/lib/cash-allocations/store", async (original) => ({ ...await original<typeof import("@/lib/cash-allocations/store")>(), loadCashAvailability: load, saveCashAllocation: save }));
import { GET, POST } from "@/app/api/cash-allocations/route";
import { CashAllocationConflict, InvalidCashAllocation } from "@/lib/cash-allocations/store";
const body = { accountId: "e36e4e59-4608-4da9-9806-7fb89b43d0bb", revision: null, businessCash: true, wholeAccountLabel: null, pots: [{ label: "Tax", amount: 1000 }] };
const request = (value: unknown = body) => new Request("https://finops.example/api/cash-allocations", { method: "POST", body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); identity.mockResolvedValue({ supabase: {}, householdId: "household-a" }); save.mockResolvedValue({ ...body, revision: 1 }); load.mockResolvedValue({ accounts: [] }); });
it("requires authentication before reads and writes", async () => {
  identity.mockResolvedValue(null);
  expect((await GET(request())).status).toBe(401); expect((await POST(request())).status).toBe(401);
  expect(load).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
it("rejects invalid money, malformed JSON and household injection before saving", async () => {
  expect((await POST(request({ ...body, householdId: "household-b" }))).status).toBe(400);
  expect((await POST(request({ ...body, pots: [{ label: "Tax", amount: -1 }] }))).status).toBe(400);
  expect((await POST(new Request("https://finops.example/api/cash-allocations", { method: "POST", body: "{" }))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});
it("uses the resolved household and invalidates all financial read caches", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(save).toHaveBeenCalledWith({}, "household-a", body); expect(invalidate).toHaveBeenCalledWith("household-a");
});
it("distinguishes conflicts, invalid accounts and unavailable storage", async () => {
  for (const [error, status] of [[new CashAllocationConflict("stale"), 409], [new InvalidCashAllocation("not found"), 400], [new Error("storage unavailable"), 500]] as const) {
    save.mockRejectedValue(error); expect((await POST(request())).status).toBe(status);
  }
  expect(invalidate).not.toHaveBeenCalled();
});
