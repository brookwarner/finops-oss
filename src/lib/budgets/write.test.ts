import { describe, it, expect } from "vitest";
import { setBudgetTarget } from "./write";

type StubResult = { data?: any; error?: any; count?: number };
function makeSupabaseStub(results: Record<string, StubResult[]>) {
  const calls: { table: string; op: string; payload?: any }[] = [];
  function builder(table: string) {
    let op = "select";
    let payload: any;
    const b: any = {
      select: (_sel?: any, _opts?: any) => b,
      update: (p: any) => { op = "update"; payload = p; return b; },
      upsert: (p: any, _o?: any) => { op = "upsert"; payload = p; calls.push({ table, op, payload }); return b; },
      insert: (p: any) => { op = "insert"; payload = p; calls.push({ table, op, payload }); return b; },
      delete: () => { op = "delete"; return b; },
      eq: () => b, neq: () => b, is: () => b, in: () => b, or: () => b, ilike: () => b,
      order: () => b, limit: () => b,
      single: () => resolve(),
      maybeSingle: () => resolve(),
      then: (onF: any, onR: any) => resolve().then(onF, onR),
    };
    function resolve() {
      if (op === "update" || op === "delete") calls.push({ table, op, payload });
      const queue = results[table] ?? [];
      const r = queue.shift() ?? { data: null, error: null };
      return Promise.resolve(r);
    }
    return b;
  }
  return { client: { from: (t: string) => builder(t) } as any, calls };
}

const HH = "hh-1";
const CAT = "c1";

describe("setBudgetTarget", () => {
  it("updates monthly_target and returns before/after", async () => {
    const { client, calls } = makeSupabaseStub({
      budgets: [
        { data: { monthly_target: 1200 }, error: null },
        { data: { id: "b1" }, error: null },
      ],
    });
    const r = await setBudgetTarget({ supabase: client, householdId: HH, categoryId: CAT, monthlyTarget: 1350 });
    expect(r).toEqual({ ok: true, previousTarget: 1200, newTarget: 1350 });
    const upd = calls.find((c) => c.table === "budgets" && c.op === "update");
    expect(upd?.payload).toMatchObject({ monthly_target: 1350 });
  });

  it("refuses when no budget row exists", async () => {
    const { client, calls } = makeSupabaseStub({ budgets: [{ data: null, error: null }] });
    const r = await setBudgetTarget({ supabase: client, householdId: HH, categoryId: CAT, monthlyTarget: 1350 });
    expect(r).toEqual({ ok: false, reason: "no-budget" });
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });
});
