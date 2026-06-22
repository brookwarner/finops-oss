import { describe, it, expect } from "vitest";
import { computeNetWorth } from "@/lib/networth/compute";

function fakeSupabase(accounts: any[]) {
  return { from() { const b: any = {
    select() { return b; }, eq() { return b; },
    then(res: any) { return res({ data: accounts, error: null }); } }; return b; } } as any;
}

// Balances are stored signed: assets positive, liabilities negative. Classification
// is by sign, and liabilities are reported as a negative total.
it("splits assets and liabilities by balance sign and nets them as a signed sum", async () => {
  const supabase = fakeSupabase([
    { name: "Everyday", type: "checking", balance_current: 5000 },
    { name: "KiwiSaver", type: "kiwisaver", balance_current: 40000 },
    { name: "Visa", type: "credit_card", balance_current: -1200 },
    { name: "Home loan", type: "mortgage", balance_current: -300000 },
  ]);
  const r = await computeNetWorth({ supabase, householdId: "h1" });
  expect(r.assets).toBe(45000);
  expect(r.liabilities).toBe(-301200); // money owed reads as a negative
  expect(r.net).toBe(-256200);
  expect(r.accounts).toHaveLength(4);
});

it("treats a negative-balance account as a liability even if typed as checking", async () => {
  // A loan/offset account mislabelled as "checking" still has a negative balance.
  const supabase = fakeSupabase([
    { name: "Everyday", type: "checking", balance_current: 2000 },
    { name: "Offset loan", type: "checking", balance_current: -21000 },
  ]);
  const r = await computeNetWorth({ supabase, householdId: "h1" });
  expect(r.assets).toBe(2000);
  expect(r.liabilities).toBe(-21000);
  expect(r.net).toBe(-19000);
  expect(r.accounts.find((a) => a.name === "Offset loan")!.isLiability).toBe(true);
});

it("excludes uncertain receivables from net worth but keeps likely ones", async () => {
  const supabase = fakeSupabase([
    { name: "Everyday", type: "checking", balance_current: 5000, expected_inflows: [] },
    { name: "Tax refund", type: "receivable", balance_current: 1200, expected_inflows: [{ likelihood: "likely" }] },
    { name: "Receivership claim", type: "receivable", balance_current: 14000, expected_inflows: [{ likelihood: "uncertain" }] },
  ]);
  const r = await computeNetWorth({ supabase, householdId: "h1" });
  expect(r.assets).toBe(6200); // 5000 + 1200 likely; the 14000 uncertain is excluded
  expect(r.accounts.map((a) => a.name)).toEqual(["Everyday", "Tax refund"]);
});

it("excludes uncertain receivables when PostgREST embeds the to-one relation as an OBJECT (not an array)", async () => {
  // PostgREST returns a unique-FK to-one embed as a single object, not a
  // one-element array (verified against prod). The exclusion must still fire.
  const supabase = fakeSupabase([
    { name: "Everyday", type: "checking", balance_current: 5000, expected_inflows: null },
    { name: "Tax refund", type: "receivable", balance_current: 1200, expected_inflows: { likelihood: "likely" } },
    { name: "Speculative claim", type: "receivable", balance_current: 14000, expected_inflows: { likelihood: "uncertain" } },
  ]);
  const r = await computeNetWorth({ supabase, householdId: "h1" });
  expect(r.assets).toBe(6200);
  expect(r.accounts.map((a) => a.name)).toEqual(["Everyday", "Tax refund"]);
});
