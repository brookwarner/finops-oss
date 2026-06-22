import { describe, it, expect } from "vitest";
import { resolveWrite } from "@/lib/telegram/resolve";

const deps = {
  resolveCategory: async (name: string) =>
    name.toLowerCase() === "pets"
      ? { ok: true as const, category: { id: "cat-pets", name: "Pets", group: null } }
      : name.toLowerCase() === "groceries"
      ? { ok: true as const, category: { id: "cat-gro", name: "Groceries", group: null } }
      : { ok: false as const, reason: "none" as const, candidates: [] },
  currentTarget: async (_id: string) => 1700,
  searchTxns: async (_q: string) => [
    { id: "t1", occurred_at: "2026-06-02", amount: -43, merchant: "Countdown", description: null, category: "Groceries" },
  ],
  needsReviewIds: async (_catId: string) => ["r1", "r2"],
};

describe("resolveWrite", () => {
  it("resolves set_budget_target", async () => {
    const r = await resolveWrite({ kind: "set_budget_target", category: "Groceries", monthlyTarget: 1800 }, deps);
    expect(r).toEqual({ ok: true, action: { kind: "set_budget_target", categoryId: "cat-gro", categoryName: "Groceries", monthlyTarget: 1800, previousTarget: 1700 } });
  });
  it("clarifies an unknown category", async () => {
    const r = await resolveWrite({ kind: "set_budget_target", category: "Nonsense", monthlyTarget: 5 }, deps);
    expect(r.ok).toBe(false);
  });
  it("resolves a recategorise to the single matching txn", async () => {
    const r = await resolveWrite({ kind: "recategorise", txnHint: "Countdown", categoryName: "Pets" }, deps);
    expect(r).toMatchObject({ ok: true, action: { kind: "recategorise", transactionId: "t1", categoryId: "cat-pets", categoryName: "Pets" } });
  });
  it("clarifies recategorise when no txn matches", async () => {
    const r = await resolveWrite({ kind: "recategorise", txnHint: "Nothing", categoryName: "Pets" }, { ...deps, searchTxns: async () => [] });
    expect(r.ok).toBe(false);
  });
  it("clarifies recategorise when several txns match", async () => {
    const many = { ...deps, searchTxns: async () => [
      { id: "t1", occurred_at: "2026-06-02", amount: -43, merchant: "Countdown", description: null, category: "Groceries" },
      { id: "t2", occurred_at: "2026-06-03", amount: -50, merchant: "Countdown", description: null, category: "Groceries" },
    ] };
    const r = await resolveWrite({ kind: "recategorise", txnHint: "Countdown", categoryName: "Pets" }, many);
    expect(r.ok).toBe(false);
  });
  it("resolves accept_suggestions to the needs_review ids", async () => {
    const r = await resolveWrite({ kind: "accept_suggestions", category: "Pets" }, deps);
    expect(r).toMatchObject({ ok: true, action: { kind: "accept_suggestions", categoryName: "Pets", transactionIds: ["r1", "r2"] } });
  });
  it("clarifies accept_suggestions when nothing is pending", async () => {
    const r = await resolveWrite({ kind: "accept_suggestions", category: "Pets" }, { ...deps, needsReviewIds: async () => [] });
    expect(r.ok).toBe(false);
  });
});
