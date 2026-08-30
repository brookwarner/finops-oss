import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/** A Supabase client parameterised over the generated `Database` schema. */
export type Db = SupabaseClient<Database>;

/**
 * Defense-in-depth household scoping for Supabase queries.
 *
 * PAT/MCP/CLI requests run through a service-role client that BYPASSES RLS, so
 * multi-tenant safety depends on every query manually appending
 * `.eq("household_id", …)`. That is honor-system and one forgotten filter is a
 * cross-household data leak. `scopedDb(supabase, householdId)` centralises the
 * filter: every accessor automatically injects `.eq("household_id", householdId)`
 * into reads/updates/deletes and stamps `household_id` onto insert/upsert
 * payloads, while still returning the underlying PostgREST query builder so
 * callers can chain `.select()/.eq()/.order()/.gte()/.range()` etc. exactly as
 * before. The produced query is identical to the hand-written one — this is a
 * behaviour-preserving centralisation, not a new filter.
 *
 * The accompanying guard test (tests/lib/supabase/scoped-guard.test.ts) fails the
 * build if any household-scoped table is queried via a raw `.from()` outside this
 * file without a `// scoped-db-exempt:` marker, so the invariant is mechanically
 * enforced rather than trusted.
 *
 * The client is parameterised over the generated `Database` schema (`Db`), so the
 * `raw` escape hatch and every `.from(table)` are schema-checked. The per-accessor
 * builder *returns* stay `any` by design (see the note on `AnyBuilder` below) —
 * tightening them is what would cascade across call sites, not the client type.
 */

/** The set of tables that carry a `household_id` column and MUST be scoped. */
export const HOUSEHOLD_SCOPED_TABLES = [
  "transactions",
  "accounts",
  "categories",
  "category_rules",
  "budgets",
  "budget_periods",
  "holdings",
  "net_worth_snapshots",
  "alerts",
  "subscriptions",
  "mortgage_parts",
  "pending_transactions",
  "amortising_liabilities",
  "expected_inflows",
] as const;

export type HouseholdScopedTable = (typeof HOUSEHOLD_SCOPED_TABLES)[number];

/** PostgREST returns at most this many rows per request by default. */
export const PAGE_SIZE = 1000;

// The supabase-js builder generics are not chainable-friendly when derived via
// ReturnType (they collapse `data` to `unknown`/`GenericStringError`, breaking the
// codebase's untyped `.map((row) => …)` usage), and iterating a *union* of table
// names distributes the per-table Insert/Select generics into an unsatisfiable
// intersection. So accessors are typed as `any`: callers keep the full PostgREST
// chain (`.eq/.order/.range/.single/...`) and the existing per-call `as` casts and
// untyped row inference are preserved exactly as before. The schema typing lives on
// the client (`Db`) instead, where it flows to every direct `.from()` call site.
type AnyBuilder = any;

export interface ScopedTable {
  /** SELECT scoped to the household. Equivalent to `.from(t).select(...).eq("household_id", id)`. */
  select: (columns?: string, options?: { head?: boolean; count?: "exact" | "planned" | "estimated" }) => AnyBuilder;
  /** UPDATE scoped to the household. The `.eq("household_id", id)` is pre-applied. */
  update: (values: Record<string, unknown>) => AnyBuilder;
  /** DELETE scoped to the household. The `.eq("household_id", id)` is pre-applied. */
  delete: () => AnyBuilder;
  /** INSERT with `household_id` stamped onto every row (single or array). */
  insert: (values: Record<string, any> | Record<string, any>[]) => AnyBuilder;
  /** UPSERT with `household_id` stamped onto every row (single or array). */
  upsert: (
    values: Record<string, any> | Record<string, any>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) => AnyBuilder;
  /**
   * Fetch every matching row across PostgREST's 1000-row page cap. Pass a
   * builder factory that receives a freshly-scoped `.from(table)` handle and must
   * call `.select(...)` plus whatever filters/ordering it needs (do NOT add
   * `.range()`/`.limit()` — paging is handled here). The `.eq("household_id", id)`
   * is pre-applied to each page. Returns the concatenated rows.
   */
  selectAllPaged: <T = any>(
    build: (q: AnyBuilder) => AnyBuilder,
    opts?: { pageSize?: number },
  ) => Promise<T[]>;
}

function stamp(
  householdId: string,
  values: Record<string, any> | Record<string, any>[],
): Record<string, any> | Record<string, any>[] {
  if (Array.isArray(values)) {
    return values.map((v) => ({ household_id: householdId, ...v }));
  }
  return { household_id: householdId, ...values };
}

function scopedTable(
  // Loose (un-parameterised) client view ON PURPOSE: typing `.from(table)` with a
  // *union* of table names distributes the per-table Insert/Update generics into an
  // unsatisfiable intersection. The schema typing lives on the public `Db` surface
  // (`scopedDb`/`raw`); here payloads stay `Record<string, any>` as before.
  supabase: SupabaseClient,
  table: HouseholdScopedTable,
  householdId: string,
): ScopedTable {
  return {
    select: (columns, options) =>
      supabase.from(table).select(columns as any, options as any).eq("household_id", householdId),
    update: (values) => supabase.from(table).update(values).eq("household_id", householdId),
    delete: () => supabase.from(table).delete().eq("household_id", householdId),
    insert: (values) => supabase.from(table).insert(stamp(householdId, values)),
    upsert: (values, options) => supabase.from(table).upsert(stamp(householdId, values), options as any),
    selectAllPaged: async (build, opts) => {
      const pageSize = opts?.pageSize ?? PAGE_SIZE;
      const out: any[] = [];
      let offset = 0;
      // Loop until a short page proves the table is exhausted, so a growing
      // table never silently truncates at the 1000-row cap. The factory owns
      // `.select()`; we pre-apply the household filter and the page range.
      for (;;) {
        const built = build(supabase.from(table)).eq("household_id", householdId);
        const q = built.range(offset, offset + pageSize - 1);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as any[];
        out.push(...rows);
        if (rows.length < pageSize) break;
        offset += pageSize;
      }
      return out;
    },
  };
}

export type ScopedDb = Record<HouseholdScopedTable, ScopedTable> & {
  /** The household id this accessor is bound to. */
  householdId: string;
  /** Escape hatch for the genuinely cross-household / unscoped query. Equivalent
   *  to `supabase.from(table)`; the caller owns correctness. Prefer the scoped
   *  accessors. Reserved for exempt tables (access_tokens, akahu_config, etc.). */
  raw: Db["from"];
};

/**
 * Build a household-scoped accessor over a Supabase client. Every table accessor
 * pre-applies the `household_id` filter / payload stamp.
 */
export function scopedDb(supabase: Db, householdId: string): ScopedDb {
  if (!householdId) throw new Error("scopedDb requires a householdId");
  const db = {
    householdId,
    raw: supabase.from.bind(supabase),
  } as ScopedDb;
  for (const table of HOUSEHOLD_SCOPED_TABLES) {
    db[table] = scopedTable(supabase, table, householdId);
  }
  return db;
}

/**
 * Generic paged reader for an already-built scoped SELECT chain when the call
 * site needs filters that `selectAllPaged`'s factory shape is awkward for. Pass a
 * factory that returns a fresh query for a given range and it loops until a short
 * page. Most callers should prefer `scopedDb(...).<table>.selectAllPaged()`.
 */
export async function readAllPaged<T = any>(
  buildRange: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await buildRange(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}
