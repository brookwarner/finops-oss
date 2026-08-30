import { CYCLE_START_DAY, defaultPeriod, toISODate, type Period } from "@/lib/budgets/period";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface IncomeBucket {
  categoryId: string;
  name: string;
  cycleStart: string;
  actual: number;
}
export interface IncomeBudgetRef { categoryId: string; name: string; target: number; }
export interface IncomeSourcePoint { categoryId: string; name: string; actual: number; plan: number; }
export interface IncomeCyclePoint {
  period_start: string;
  period_end: string;
  total: number;
  plannedTotal: number;
  sources: IncomeSourcePoint[];
}
export interface IncomeHistory { cycles: IncomeCyclePoint[]; }

export function shapeIncomeHistory(
  buckets: IncomeBucket[],
  budgets: IncomeBudgetRef[],
  cycles: Period[],
): IncomeHistory {
  const sources = new Map<string, { name: string; plan: number }>();
  for (const b of budgets) sources.set(b.categoryId, { name: b.name, plan: b.target });
  for (const bk of buckets) {
    if (!sources.has(bk.categoryId)) sources.set(bk.categoryId, { name: bk.name, plan: 0 });
  }
  const actualByKey = new Map<string, number>();
  for (const bk of buckets) {
    const k = `${bk.categoryId}|${bk.cycleStart}`;
    actualByKey.set(k, (actualByKey.get(k) ?? 0) + bk.actual);
  }
  const ordered = [...sources.entries()].sort((a, b) =>
    b[1].plan - a[1].plan || a[1].name.localeCompare(b[1].name));
  const plannedTotal = ordered.reduce((sum, [, s]) => sum + s.plan, 0);

  const out: IncomeCyclePoint[] = cycles.map((c) => {
    const start = toISODate(c.start);
    const points: IncomeSourcePoint[] = ordered.map(([categoryId, s]) => ({
      categoryId, name: s.name, plan: s.plan,
      actual: actualByKey.get(`${categoryId}|${start}`) ?? 0,
    }));
    const total = points.reduce((sum, p) => sum + p.actual, 0);
    return { period_start: start, period_end: toISODate(c.end), total, plannedTotal, sources: points };
  });
  return { cycles: out };
}

export interface IncomeTxn { category_id: string | null; amount: number; occurred_at: string; }

export function bucketIncomeTxns(
  txns: IncomeTxn[],
  cycles: Period[],
  nameById: Map<string, string>,
): IncomeBucket[] {
  const byKey = new Map<string, IncomeBucket>();
  for (const t of txns) {
    const cat = t.category_id;
    if (!cat) continue;
    const when = new Date(t.occurred_at).getTime();
    const cycle = cycles.find((c) => when >= c.start.getTime() && when < c.end.getTime());
    if (!cycle) continue;
    const cycleStart = toISODate(cycle.start);
    const k = `${cat}|${cycleStart}`;
    const existing = byKey.get(k);
    if (existing) existing.actual += Number(t.amount);
    else byKey.set(k, { categoryId: cat, name: nameById.get(cat) ?? cat, cycleStart, actual: Number(t.amount) });
  }
  return [...byKey.values()];
}

function lastNCyclesUTC(now: Date, n: number): Period[] {
  const cur = defaultPeriod(now);
  const y = cur.start.getUTCFullYear();
  const m = cur.start.getUTCMonth();
  const cycles: Period[] = [];
  for (let i = 0; i < n; i++) {
    cycles.push({
      start: new Date(Date.UTC(y, m - i, CYCLE_START_DAY)),
      end: new Date(Date.UTC(y, m - i + 1, CYCLE_START_DAY)),
    });
  }
  return cycles;
}

/**
 * Cycle-count limit clamped to [1, 36], default 12. NaN-safe: a malformed
 * `?limit=abc` (Number("abc") -> NaN) falls back to the default rather than
 * propagating through min/max and yielding zero cycles.
 */
export function clampCycleLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(36, limit as number)) : 12;
}

export async function getIncomeHistory(
  supabase: SupabaseClient,
  householdId: string,
  opts: { limit?: number } = {},
): Promise<IncomeHistory> {
  const limit = clampCycleLimit(opts.limit);
  const cycles = lastNCyclesUTC(new Date(), limit);
  const oldestStart = cycles[cycles.length - 1].start;
  const newestEnd = cycles[0].end;
  const db = scopedDb(supabase, householdId);

  const [catsRes, budgetsRes] = await Promise.all([
    db.categories.select("id, name, kind").eq("kind", "income"),
    db.budgets
      .select("monthly_target, active, kind, category_id, categories(id, name)")
      .eq("kind", "income").eq("active", true),
  ]);
  if (catsRes.error) throw new Error(catsRes.error.message);
  if (budgetsRes.error) throw new Error(budgetsRes.error.message);

  const incomeCatIds = new Set((catsRes.data ?? []).map((c: any) => c.id as string));
  const nameById = new Map<string, string>(
    (catsRes.data ?? []).map((c: any) => [c.id as string, c.name as string]),
  );
  const budgets: IncomeBudgetRef[] = (budgetsRes.data ?? []).map((b: any) => {
    const cat = getFirstNested(b.categories);
    return {
      categoryId: (b.category_id as string) ?? cat?.id ?? "",
      name: cat?.name ?? nameById.get(b.category_id as string) ?? "",
      target: Number(b.monthly_target),
    };
  });

  const rows: any[] = await db.transactions.selectAllPaged((q) =>
    q.select("amount, category_id, occurred_at")
      .gte("occurred_at", oldestStart.toISOString())
      .lt("occurred_at", newestEnd.toISOString())
      .not("category_id", "is", null)
      .order("occurred_at", { ascending: false }),
  );
  const incomeTxns: IncomeTxn[] = rows.filter((t) => incomeCatIds.has(t.category_id as string));

  const buckets = bucketIncomeTxns(incomeTxns, cycles, nameById);
  return shapeIncomeHistory(buckets, budgets, cycles);
}
