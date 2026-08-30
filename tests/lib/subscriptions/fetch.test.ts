import { describe, it, expect } from "vitest";
import { fetchSubscriptions, SUBSCRIPTION_SELECT } from "@/lib/subscriptions/fetch";

function fakeSupabase(result: { data?: unknown; error?: { message: string } | null }) {
  const calls: { table?: string; select?: string; eq?: [string, unknown] } = {};
  const supabase = {
    from(table: string) {
      calls.table = table;
      return {
        select(sel: string) {
          calls.select = sel;
          return {
            eq(col: string, val: unknown) {
              calls.eq = [col, val];
              return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
            },
          };
        },
      };
    },
  } as never;
  return { supabase, calls };
}

describe("fetchSubscriptions", () => {
  it("queries the subscriptions table with the canonical column set, scoped to household", async () => {
    const { supabase, calls } = fakeSupabase({ data: [{ display_name: "Netflix" }] });
    const rows = await fetchSubscriptions(supabase, "hh-1");
    expect(calls.table).toBe("subscriptions");
    expect(calls.select).toBe(SUBSCRIPTION_SELECT);
    expect(calls.eq).toEqual(["household_id", "hh-1"]);
    expect(rows).toEqual([{ display_name: "Netflix" }]);
  });

  it("returns an empty array when data is null", async () => {
    const { supabase } = fakeSupabase({ data: null });
    expect(await fetchSubscriptions(supabase, "hh-1")).toEqual([]);
  });

  it("throws the query error message", async () => {
    const { supabase } = fakeSupabase({ error: { message: "boom" } });
    await expect(fetchSubscriptions(supabase, "hh-1")).rejects.toThrow("boom");
  });

  it("exposes a stable select string", () => {
    expect(SUBSCRIPTION_SELECT).toContain("display_name");
    expect(SUBSCRIPTION_SELECT).toContain("category_id");
  });
});
