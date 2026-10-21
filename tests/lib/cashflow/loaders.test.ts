import { expect, it } from "vitest";
import { computeCashflowBase } from "@/lib/cashflow/compute";
import { loadIncomeTxns } from "@/lib/forecast/loaders";
import { scopedDb } from "@/lib/supabase/scoped";
function database(rows: any[], failSecondPage = false) {
  const pages: number[] = [];
  const db = { from(table: string) {
    let from = 0, to = 999;
    const filters: [string, any][] = [];
    const b: any = { select: () => b, order: () => b, gte: () => b,
      eq: (key: string, value: any) => { filters.push([key, value]); return b; },
      gt: () => b, lt: () => b,
      range: (a: number, z: number) => { from = a; to = z; return b; },
      then: (resolve: any) => {
        let data = table === "transactions" ? rows : [];
        for (const [key, value] of filters) if (key === "categories.kind") data = data.filter(t => t.categories.kind === value);
        if (table === "transactions") pages.push(from);
        return Promise.resolve({ data: data.slice(from, to + 1),
          error: failSecondPage && from > 0 ? { message: "page unavailable" } : null }).then(resolve);
      } };
    return b;
  } } as any;
  return { db, pages };
}
const spending = Array.from({ length: 1100 }, (_, id) => ({ id: String(id), amount: -1,
  category_id: "food", occurred_at: "2026-10-20T00:00:00Z", categories: { kind: "monthly_cap", spend_class: "essential" } }));
it("cashflow includes spending past the 1000-row boundary", async () => {
  const { db, pages } = database(spending);
  const result = await computeCashflowBase({ supabase: db, householdId: "h1" });
  expect(result.actualCaps[0].dailyActual).toBeCloseTo(1100 / 90);
  expect(pages).toContain(1000);
});
it("income inference reads every page of eligible income", async () => {
  const { db } = database(spending.map(t => ({ ...t, amount: 1, description: "Pay",
    categories: { kind: "income", income_type: "recurring" } })));
  const result = await loadIncomeTxns(scopedDb(db, "h1"), new Date());
  expect(result).toHaveLength(1100);
});
it("a failed page cannot become a partial spending estimate", async () => {
  const { db } = database(spending, true);
  await expect(computeCashflowBase({ supabase: db, householdId: "h1" })).rejects.toThrow("page unavailable");
});
