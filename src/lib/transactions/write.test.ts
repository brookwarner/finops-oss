import { describe, it, expect } from "vitest";
import { categoriseTransactions, acceptSuggestions, applySimilar } from "./write";

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
const CAT = "11111111-1111-4111-8111-111111111111";

describe("categoriseTransactions", () => {
  it("single real category learns a rule and reports similarCount", async () => {
    const { client, calls } = makeSupabaseStub({
      transactions: [
        { error: null },
        { data: { merchant: "PAKNSAVE", description: "card 1234" }, error: null },
        { count: 7, error: null },
      ],
      category_rules: [{ error: null }, { error: null }],
    });
    const r = await categoriseTransactions({ supabase: client, householdId: HH,
      transactionIds: ["t1"], categoryId: CAT });
    expect(r).toEqual({ updated: 1, similarCount: 7, similarMerchant: "PAKNSAVE" });
    expect(calls.some((c) => c.table === "category_rules" && c.op === "upsert")).toBe(true);
  });

  it("bulk categorise updates without learning, similarCount 0", async () => {
    const { client, calls } = makeSupabaseStub({ transactions: [{ error: null }] });
    const r = await categoriseTransactions({ supabase: client, householdId: HH,
      transactionIds: ["t1", "t2", "t3"], categoryId: CAT });
    expect(r).toEqual({ updated: 3, similarCount: 0 });
    expect(calls.some((c) => c.table === "category_rules")).toBe(false);
  });

  it("uncategorise (null) clears and skips learning", async () => {
    const { client, calls } = makeSupabaseStub({ transactions: [{ error: null }] });
    const r = await categoriseTransactions({ supabase: client, householdId: HH,
      transactionIds: ["t1"], categoryId: null });
    expect(r).toEqual({ updated: 1, similarCount: 0 });
    expect(calls.some((c) => c.table === "category_rules")).toBe(false);
    const upd = calls.find((c) => c.table === "transactions" && c.op === "update");
    expect(upd?.payload).toMatchObject({ category_id: null, is_manual_category: false, needs_review: false });
  });
});

describe("acceptSuggestions", () => {
  it("accepting a categorised suggestion clears review, marks manual, and learns a rule", async () => {
    // Accepting a suggestion is an explicit confirmation: it must teach a rule so
    // the same wording never gets re-asked. Mirrors categoriseTransactions.
    const { client, calls } = makeSupabaseStub({
      transactions: [
        { data: [{ id: "t1", category_id: CAT, merchant: "PAKNSAVE", description: "card 1234" }], error: null }, // fetch targets
        { error: null }, // update: clear review + mark manual
      ],
      category_rules: [{ error: null }, { error: null }], // upsert learned + delete stale llm
    });
    const r = await acceptSuggestions({ supabase: client, householdId: HH, transactionIds: ["t1"] });
    expect(r).toEqual({ accepted: 1 });
    const upd = calls.find((c) => c.table === "transactions" && c.op === "update");
    expect(upd?.payload).toMatchObject({ needs_review: false, is_manual_category: true });
    const ruleUpsert = calls.find((c) => c.table === "category_rules" && c.op === "upsert");
    expect(ruleUpsert?.payload).toMatchObject({ category_id: CAT, field: "merchant", match_value: "PAKNSAVE" });
  });

  it("accepting an uncategorised suggestion clears review without marking manual or learning", async () => {
    const { client, calls } = makeSupabaseStub({
      transactions: [
        { data: [{ id: "t1", category_id: null, merchant: null, description: "mystery" }], error: null }, // fetch targets
        { error: null }, // update: clear review only
      ],
    });
    const r = await acceptSuggestions({ supabase: client, householdId: HH, transactionIds: ["t1"] });
    expect(r).toEqual({ accepted: 1 });
    const upd = calls.find((c) => c.table === "transactions" && c.op === "update");
    expect(upd?.payload).toMatchObject({ needs_review: false });
    expect(upd?.payload?.is_manual_category).toBeUndefined();
    expect(calls.some((c) => c.table === "category_rules")).toBe(false);
  });
});

describe("applySimilar", () => {
  it("sets category on non-manual txns for a merchant", async () => {
    const { client } = makeSupabaseStub({ transactions: [{ data: [{ id: "t1" }], error: null }] });
    const r = await applySimilar({ supabase: client, householdId: HH, merchant: "PAKNSAVE", categoryId: CAT });
    expect(r).toEqual({ updated: 1 });
  });
});
