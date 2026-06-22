import { describe, it, expect } from "vitest";
import { recentTransactions, searchTransactions } from "@/lib/transactions/query";

function captureSupabase(rows: any[]) {
  const calls: any = {};
  const b: any = {
    select(s: string) { calls.select = s; return b; },
    eq(k: string, v: any) { calls[k] = v; return b; },
    ilike(col: string, val: string) { calls.ilike = [col, val]; return b; },
    or(expr: string) { calls.or = expr; return b; },
    gte(_c: string, v: any) { calls.gte = v; return b; },
    order() { return b; }, limit(n: number) { calls.limit = n; return b; },
    then(res: any) { return res({ data: rows, error: null }); },
  };
  return { client: { from: () => b } as any, calls };
}

it("recentTransactions scopes by household and limit", async () => {
  const { client, calls } = captureSupabase([{ id: "t1", amount: 10, merchant: "X", occurred_at: "2026-06-20" }]);
  const r = await recentTransactions({ supabase: client, householdId: "h1", limit: 5 });
  expect(calls.household_id).toBe("h1");
  expect(calls.limit).toBe(5);
  expect(r).toHaveLength(1);
});

it("searchTransactions matches merchant or description", async () => {
  const { client, calls } = captureSupabase([]);
  await searchTransactions({ supabase: client, householdId: "h1", query: "uber", limit: 10 });
  expect(calls.or).toContain("uber");
});
