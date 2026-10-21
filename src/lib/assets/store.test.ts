import { expect, it, vi } from "vitest";
import { upsertManualAsset } from "./store";
const categoryId = "10000000-0000-4000-8000-000000000001";
function client(category: object | null = { id: categoryId }) {
  const rpc = vi.fn().mockResolvedValue({ data: {
    akahu_account_id: "manual_test", name: "Loan", type: "other", currency: "NZD",
    institution: "Manual", balance_current: -75,
    loan: { anchor_balance: 100, anchor_date: "2026-01-01", annual_rate: 0,
      repayment_category_id: categoryId, repayment_category_name: "Repayments" },
  }, error: null });
  const from = vi.fn((table: string) => {
    const b: any = { select: () => b, eq: () => b, gte: () => b, order: () => b, range: () => b,
      maybeSingle: async () => ({ data: category, error: null }),
      then: (resolve: any) => Promise.resolve({ data: table === "transactions"
        ? [{ amount: -25, occurred_at: "2026-01-02T00:00:00Z" }] : [], error: null }).then(resolve) };
    return b;
  });
  return { db: { from, rpc } as any, rpc, from };
}
const input = { id: "manual_test", name: "Loan", balance: -100,
  loan: { annualRate: 0, repaymentCategoryId: categoryId, anchorDate: "2026-01-01" } };
it("saves the projected balance and its original loan anchor in one RPC", async () => {
  const { db, rpc } = client();
  const asset = await upsertManualAsset({ supabase: db, householdId: "household", input });
  expect(rpc).toHaveBeenCalledWith("save_manual_asset", expect.objectContaining({
    p_household_id: "household", p_create: false,
    p_asset: expect.objectContaining({ balance_current: -75 }),
    p_loan: expect.objectContaining({ anchor_balance: 100 }),
  }));
  expect(asset.balance).toBe(-75);
  expect(asset.loan?.anchorBalance).toBe(100);
});
it("rejects a foreign repayment category before any write", async () => {
  const { db, rpc } = client(null);
  await expect(upsertManualAsset({ supabase: db, householdId: "household", input }))
    .rejects.toThrow("repayment category not found");
  expect(rpc).not.toHaveBeenCalled();
});
it("rejects invalid dates and rates at the shared boundary", async () => {
  for (const loan of [{ ...input.loan, annualRate: -1 }, { ...input.loan, anchorDate: "2026-02-30" }]) {
    const { db, rpc, from } = client();
    await expect(upsertManualAsset({ supabase: db, householdId: "household", input: { ...input, loan } })).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  }
});
it("propagates an atomic save failure without making individual account writes", async () => {
  const { db, rpc, from } = client();
  rpc.mockResolvedValueOnce({ data: null, error: { message: "child write failed" } });
  await expect(upsertManualAsset({ supabase: db, householdId: "household", input })).rejects.toThrow("child write failed");
  expect(from.mock.calls.some(([table]) => table === "accounts")).toBe(false);
});
