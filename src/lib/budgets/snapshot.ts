import { CYCLE_START_DAY, defaultPeriod, type Period } from "./period";
import type { BudgetComputeResult, BudgetKind, RagStatus } from "./compute";
import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";

export interface SnapshotRecord {
  budget_id: string;
  household_id: string;
  period_start: string;
  period_end: string;
  target: number;
  spent: number;
  reimbursed: number;
  effective_spend: number;
  pct: number;
  status: RagStatus;
  kind: BudgetKind;
  reserve_balance: number | null;
  carryover: number;
}

export function snapshotRecordsFromResult(
  result: BudgetComputeResult,
  householdId: string,
): SnapshotRecord[] {
  return result.rows.map((r) => ({
    budget_id: r.budgetId,
    household_id: householdId,
    period_start: result.period.start,
    period_end: result.period.end,
    target: r.target,
    spent: r.spent,
    reimbursed: r.reimbursed,
    effective_spend: r.effectiveSpend,
    pct: r.pct,
    status: r.status,
    kind: r.kind,
    reserve_balance: r.kind === "reserve" ? r.reserveBalance : null,
    carryover: 0,
  }));
}

/**
 * The most-recent `n` budget cycles (20th->20th), current cycle first.
 * Date arithmetic handles month underflow and the year wrap automatically.
 */
export function lastNCycles(now: Date, n: number): Period[] {
  const cur = defaultPeriod(now);
  const cycles: Period[] = [];
  for (let i = 0; i < n; i++) {
    const start = new Date(cur.start.getFullYear(), cur.start.getMonth() - i, CYCLE_START_DAY);
    const end = new Date(cur.start.getFullYear(), cur.start.getMonth() - i + 1, CYCLE_START_DAY);
    cycles.push({ start, end });
  }
  return cycles;
}

export interface RawHistoryRow {
  categoryId: string;
  period_start: string; period_end: string;
  target: number; spent: number; reimbursed: number; effective_spend: number;
  pct: number; status: RagStatus; kind: BudgetKind;
  reserve_balance: number | null; carryover: number;
  category: string; group: string | null;
}
export interface HistoryPoint {
  period_start: string; period_end: string;
  target: number; spent: number; reimbursed: number; effective_spend: number;
  pct: number; status: RagStatus; kind: BudgetKind;
  reserve_balance: number | null; carryover: number;
}
export interface CategoryHistory { found: boolean; category: string; series: HistoryPoint[]; }
export interface CycleHistory { period_start: string; period_end: string; budgets: (HistoryPoint & { category: string; group: string | null })[]; }

function toPoint(r: RawHistoryRow): HistoryPoint {
  return { period_start: r.period_start, period_end: r.period_end, target: r.target, spent: r.spent,
    reimbursed: r.reimbursed, effective_spend: r.effective_spend, pct: r.pct, status: r.status,
    kind: r.kind, reserve_balance: r.reserve_balance, carryover: r.carryover };
}

/** Filter raw rows to a single category (exact then substring), newest first. */
export function shapeCategorySeries(rows: RawHistoryRow[], category: string): CategoryHistory {
  const q = category.toLowerCase();
  const matches = rows.filter((r) => r.category.toLowerCase() === q);
  const picked = matches.length ? matches : rows.filter((r) => r.category.toLowerCase().includes(q));
  if (!picked.length) return { found: false, category, series: [] };
  const series = [...picked].sort((a, b) => b.period_start.localeCompare(a.period_start)).map(toPoint);
  return { found: true, category: picked[0].category, series };
}

/** Group raw rows into cycles, newest first. */
export function shapeCyclesByPeriod(rows: RawHistoryRow[]): CycleHistory[] {
  const byPeriod = new Map<string, CycleHistory>();
  for (const r of rows) {
    const c = byPeriod.get(r.period_start) ??
      { period_start: r.period_start, period_end: r.period_end, budgets: [] };
    c.budgets.push({ ...toPoint(r), category: r.category, group: r.group });
    byPeriod.set(r.period_start, c);
  }
  return [...byPeriod.values()].sort((a, b) => b.period_start.localeCompare(a.period_start));
}

/** Upsert snapshot records by (budget_id, period_start). */
export async function upsertSnapshots(supabase: SupabaseClient, records: SnapshotRecord[]): Promise<void> {
  if (!records.length) return;
  // scoped-db-exempt: records are pre-built SnapshotRecord[] each carrying its own
  // household_id (set by snapshotRecordsFromResult); no single householdId param
  // is in scope. The upsert conflict key is (budget_id, period_start) and budget_id
  // is household-unique.
  const { error } = await supabase
    .from("budget_periods")
    .upsert(records, { onConflict: "budget_id,period_start" });
  if (error) throw new Error(error.message);
}

export interface HistoryOpts { category?: string; limit?: number; }

/** Query budget_periods, unwrap embeds, and trim to the most-recent `limit` cycles (newest first). */
async function fetchTrimmedHistory(
  supabase: SupabaseClient, householdId: string, limit: number,
): Promise<RawHistoryRow[]> {
  const { data, error } = await scopedDb(supabase, householdId).budget_periods
    .select("period_start, period_end, target, spent, reimbursed, effective_spend, pct, status, kind, reserve_balance, carryover, budgets!inner(category_id, categories!inner(name, \"group\"))")
    .order("period_start", { ascending: false });
  if (error) throw new Error(error.message);

  const rows: RawHistoryRow[] = (data ?? []).map((d: any) => {
    const budget = getFirstNested(d.budgets);
    const cat = getFirstNested(budget?.categories);
    return { categoryId: budget?.category_id ?? "", period_start: d.period_start, period_end: d.period_end,
      target: Number(d.target), spent: Number(d.spent), reimbursed: Number(d.reimbursed),
      effective_spend: Number(d.effective_spend), pct: Number(d.pct), status: d.status, kind: d.kind,
      reserve_balance: d.reserve_balance === null ? null : Number(d.reserve_balance),
      carryover: Number(d.carryover), category: cat?.name ?? "", group: cat?.group ?? null };
  });

  const periods = [...new Set(rows.map((r) => r.period_start))]
    .sort((a, b) => b.localeCompare(a)).slice(0, limit);
  const kept = new Set(periods);
  return rows.filter((r) => kept.has(r.period_start));
}

/** Read snapshots and shape them. Pulls the most-recent `limit` cycles (default 6). */
export async function getHistory(
  supabase: SupabaseClient, householdId: string, opts: HistoryOpts = {},
): Promise<CategoryHistory | { cycles: CycleHistory[] }> {
  const trimmed = await fetchTrimmedHistory(supabase, householdId, opts.limit ?? 6);
  if (opts.category) return shapeCategorySeries(trimmed, opts.category);
  return { cycles: shapeCyclesByPeriod(trimmed) };
}

/** Group raw history rows by category id, each series newest-first. */
export function historyByCategoryId(rows: RawHistoryRow[]): Map<string, HistoryPoint[]> {
  const byCat = new Map<string, HistoryPoint[]>();
  for (const r of rows) {
    const list = byCat.get(r.categoryId) ?? [];
    list.push(toPoint(r));
    byCat.set(r.categoryId, list);
  }
  for (const list of byCat.values()) {
    list.sort((a, b) => b.period_start.localeCompare(a.period_start));
  }
  return byCat;
}

/** Per-category history map for the budgets page (most-recent `limit` cycles). */
export async function getHistoryMap(
  supabase: SupabaseClient, householdId: string, limit = 6,
): Promise<Map<string, HistoryPoint[]>> {
  return historyByCategoryId(await fetchTrimmedHistory(supabase, householdId, limit));
}
