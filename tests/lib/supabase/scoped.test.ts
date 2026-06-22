import { describe, it, expect } from "vitest";
import { scopedDb, HOUSEHOLD_SCOPED_TABLES, PAGE_SIZE } from "@/lib/supabase/scoped";

/**
 * A capturing fake of the supabase-js query builder. Records the table, the
 * select/eq/filter calls, any insert/upsert payload, and `.range()` windows so we
 * can assert (a) the household filter is injected and (b) the paged reader walks
 * past PostgREST's 1000-row cap.
 */
function fakeClient(opts: { pages?: any[][]; rows?: any[] } = {}) {
  const log: {
    table?: string;
    eqs: Array<[string, any]>;
    insertPayload?: any;
    upsertPayload?: any;
    upsertOptions?: any;
    updatePayload?: any;
    deleted?: boolean;
    ranges: Array<[number, number]>;
    select?: string;
  } = { eqs: [], ranges: [] };

  let pageIndex = 0;

  function builder(table: string): any {
    const b: any = {
      _table: table,
      select(sel?: string) {
        log.table = table;
        log.select = sel;
        return b;
      },
      insert(payload: any) {
        log.table = table;
        log.insertPayload = payload;
        return b;
      },
      upsert(payload: any, options?: any) {
        log.table = table;
        log.upsertPayload = payload;
        log.upsertOptions = options;
        return b;
      },
      update(payload: any) {
        log.table = table;
        log.updatePayload = payload;
        return b;
      },
      delete() {
        log.table = table;
        log.deleted = true;
        return b;
      },
      eq(k: string, v: any) {
        log.eqs.push([k, v]);
        return b;
      },
      in() { return b; },
      gte() { return b; },
      lt() { return b; },
      not() { return b; },
      is() { return b; },
      or() { return b; },
      order() { return b; },
      limit() { return b; },
      range(from: number, to: number) {
        log.ranges.push([from, to]);
        // Serve successive pages when configured (for the pagination test).
        if (opts.pages) {
          const data = opts.pages[pageIndex] ?? [];
          pageIndex += 1;
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({ data: opts.rows ?? [], error: null });
      },
      then(resolve: any) {
        return resolve({ data: opts.rows ?? [], error: null });
      },
    };
    return b;
  }

  return { client: { from: (t: string) => builder(t) } as any, log };
}

describe("scopedDb", () => {
  it("exposes an accessor for every household-scoped table", () => {
    const { client } = fakeClient();
    const db = scopedDb(client, "h1");
    for (const t of HOUSEHOLD_SCOPED_TABLES) {
      expect(db[t]).toBeDefined();
      expect(typeof db[t].select).toBe("function");
    }
    expect(db.householdId).toBe("h1");
  });

  it("throws when no householdId is supplied", () => {
    const { client } = fakeClient();
    expect(() => scopedDb(client, "")).toThrow(/householdId/);
  });

  it("injects .eq('household_id', id) into reads", async () => {
    const { client, log } = fakeClient({ rows: [{ id: "t1" }] });
    await scopedDb(client, "hh-7").transactions.select("id").eq("merchant", "X");
    expect(log.table).toBe("transactions");
    expect(log.eqs).toContainEqual(["household_id", "hh-7"]);
    // The caller's own .eq is preserved alongside the injected one.
    expect(log.eqs).toContainEqual(["merchant", "X"]);
  });

  it("injects .eq('household_id', id) into updates", async () => {
    const { client, log } = fakeClient({ rows: [] });
    await scopedDb(client, "hh-9").budgets.update({ monthly_target: 100 }).eq("category_id", "c1");
    expect(log.table).toBe("budgets");
    expect(log.updatePayload).toEqual({ monthly_target: 100 });
    expect(log.eqs).toContainEqual(["household_id", "hh-9"]);
  });

  it("injects .eq('household_id', id) into deletes", async () => {
    const { client, log } = fakeClient({ rows: [] });
    await scopedDb(client, "hh-3").category_rules.delete().eq("source", "llm");
    expect(log.deleted).toBe(true);
    expect(log.eqs).toContainEqual(["household_id", "hh-3"]);
  });

  it("stamps household_id onto a single insert payload", async () => {
    const { client, log } = fakeClient({ rows: [] });
    await scopedDb(client, "hh-1").alerts.insert({ type: "cap_breach" });
    expect(log.insertPayload).toEqual({ household_id: "hh-1", type: "cap_breach" });
  });

  it("stamps household_id onto every row of a bulk insert", async () => {
    const { client, log } = fakeClient({ rows: [] });
    await scopedDb(client, "hh-2").alerts.insert([{ type: "a" }, { type: "b" }]);
    expect(log.insertPayload).toEqual([
      { household_id: "hh-2", type: "a" },
      { household_id: "hh-2", type: "b" },
    ]);
  });

  it("stamps household_id onto upsert payloads and forwards options", async () => {
    const { client, log } = fakeClient({ rows: [] });
    await scopedDb(client, "hh-5").subscriptions.upsert([{ merchant_key: "k" }], {
      onConflict: "household_id,merchant_key",
    });
    expect(log.upsertPayload).toEqual([{ household_id: "hh-5", merchant_key: "k" }]);
    expect(log.upsertOptions).toEqual({ onConflict: "household_id,merchant_key" });
  });
});

describe("selectAllPaged", () => {
  it("fetches beyond the 1000-row page cap by walking ranges", async () => {
    // Two full pages then a short final page → three .range() calls total.
    const fullA = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `a${i}` }));
    const fullB = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: `b${i}` }));
    const tail = [{ id: "z0" }, { id: "z1" }];
    const { client, log } = fakeClient({ pages: [fullA, fullB, tail] });

    const rows = await scopedDb(client, "hh-page").transactions.selectAllPaged((q) =>
      q.select("id").gte("occurred_at", "2020-01-01"),
    );

    expect(rows).toHaveLength(PAGE_SIZE * 2 + tail.length);
    // Three page reads with contiguous, non-overlapping windows.
    expect(log.ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
    ]);
    // Household filter applied to the paged read too.
    expect(log.eqs).toContainEqual(["household_id", "hh-page"]);
  });

  it("stops after a single short page (no over-fetch)", async () => {
    const { client, log } = fakeClient({ pages: [[{ id: "only" }]] });
    const rows = await scopedDb(client, "hh-one").transactions.selectAllPaged((q) => q.select("id"));
    expect(rows).toHaveLength(1);
    expect(log.ranges).toHaveLength(1);
  });

  it("honours a custom pageSize", async () => {
    const full = Array.from({ length: 2 }, (_, i) => ({ id: i }));
    const { client, log } = fakeClient({ pages: [full, [{ id: "x" }]] });
    await scopedDb(client, "hh-cust").holdings.selectAllPaged((q) => q.select("id"), { pageSize: 2 });
    expect(log.ranges[0]).toEqual([0, 1]);
    expect(log.ranges[1]).toEqual([2, 3]);
  });
});
