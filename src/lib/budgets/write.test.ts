import { describe, it, expect } from "vitest";
import { setBudgetTarget, createBudget } from "./write";

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

describe("createBudget", () => {
  it("creates the category and the budget when the category doesn't exist yet", async () => {
    const { client, calls } = makeSupabaseStub({
      categories: [
        { data: [], error: null },                                  // list to look for an exact match
        { data: { id: "cat-new", group: "Maintenance" }, error: null }, // insert().select().single()
      ],
      budgets: [
        { data: null, error: null },  // no existing budget
        { data: null, error: null },  // insert
      ],
    });
    const r = await createBudget({
      supabase: client, householdId: HH, categoryName: "Firewood",
      kind: "reserve", monthlyTarget: 66.67, group: "Maintenance",
    });
    expect(r).toEqual({
      ok: true, categoryId: "cat-new", categoryCreated: true,
      kind: "reserve", monthlyTarget: 66.67, group: "Maintenance",
    });
    const catInsert = calls.find((c) => c.table === "categories" && c.op === "insert");
    expect(catInsert?.payload).toMatchObject({ name: "Firewood", kind: "reserve", group: "Maintenance" });
    const budgetInsert = calls.find((c) => c.table === "budgets" && c.op === "insert");
    expect(budgetInsert?.payload).toMatchObject({ category_id: "cat-new", kind: "reserve", monthly_target: 66.67, active: true });
  });

  it("attaches to an existing category (case-insensitive exact match) without creating a duplicate", async () => {
    const { client, calls } = makeSupabaseStub({
      categories: [{ data: [{ id: "cat-1", name: "firewood", group: "Home" }], error: null }],
      budgets: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    });
    const r = await createBudget({
      supabase: client, householdId: HH, categoryName: "Firewood",
      kind: "reserve", monthlyTarget: 66.67,
    });
    expect(r).toEqual({
      ok: true, categoryId: "cat-1", categoryCreated: false,
      kind: "reserve", monthlyTarget: 66.67, group: "Home",
    });
    expect(calls.some((c) => c.table === "categories" && c.op === "insert")).toBe(false);
  });

  it("refuses when the category already has a budget", async () => {
    const { client, calls } = makeSupabaseStub({
      categories: [{ data: [{ id: "cat-1", name: "Groceries", group: "Food" }], error: null }],
      budgets: [{ data: { monthly_target: 1700 }, error: null }],
    });
    const r = await createBudget({
      supabase: client, householdId: HH, categoryName: "Groceries",
      kind: "monthly_cap", monthlyTarget: 1800,
    });
    expect(r).toEqual({ ok: false, reason: "already-has-budget", existingTarget: 1700 });
    expect(calls.some((c) => c.table === "budgets" && c.op === "insert")).toBe(false);
  });

  it("refuses an invalid kind before touching the database", async () => {
    const { client, calls } = makeSupabaseStub({});
    const r = await createBudget({
      supabase: client, householdId: HH, categoryName: "Firewood",
      kind: "bogus", monthlyTarget: 66.67,
    });
    expect(r).toEqual({ ok: false, reason: "invalid-kind" });
    expect(calls.length).toBe(0);
  });
});
