import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import {
  defaultPeriod,
  periodProgress,
  toISODate,
  type Period,
} from "@/lib/budgets/period";

// Daily burn: how fast am I spending my variable (monthly_cap) allowance, day by
// day, and is that pace trending up or down? "Burn" is scoped to monthly_cap
// budget categories — the same discretionary set the forecast walks as its
// `dailyBurn` drag (Σ monthly_cap targets ÷ cycle length). This surfaces the
// ACTUAL per-day spend against that planned daily figure so the owner can see, at a
// glance on the budgets hero, whether he's burning hotter or cooler than plan.
//
// Refunds net: per the house spend convention, daily spend is Σ(-amount) across
// the day's monthly_cap transactions, so an inflow (positive amount) reduces that
// day's burn. A heavy-refund day can read negative — truthful, not clamped.

const DAY_MS = 86_400_000;
const DEFAULT_TRAILING_DAYS = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DailyBurnDay {
  /** UTC calendar day, ISO yyyy-mm-dd. */
  date: string;
  /** Net outflow that day (Σ -amount over monthly_cap txns); negative on a refund day. */
  spend: number;
  /** 1-based position within the cycle. */
  dayOfCycle: number;
}

export interface DailyBurnResult {
  cycleStart: string;
  cycleEnd: string;
  /** Day number within the cycle as of `now` (1-based). */
  dayOfPeriod: number;
  /** Total days in the cycle. */
  periodLength: number;
  /** Elapsed days only, oldest → newest. */
  days: DailyBurnDay[];
  /** Σ active monthly_cap targets ÷ periodLength — the planned daily drag (matches the forecast). */
  plannedPerDay: number;
  /** Σ days.spend — variable spend so far this cycle. */
  spentSoFar: number;
  /** spentSoFar ÷ dayOfPeriod — the whole-cycle average daily pace. */
  cyclePerDay: number;
  /** Average daily burn over the last `trailingDays` days — the headline pace. */
  trailingPerDay: number;
  /** Average over the `trailingDays` days before the trailing window; null when the cycle is too young to compare. */
  priorPerDay: number | null;
  /** trailingPerDay − plannedPerDay; positive = burning hotter than plan. */
  vsPlan: number;
  /** trailingPerDay − (priorPerDay ?? cyclePerDay); positive = pace rising. */
  trend: number;
  /** Window size actually used (clamped to elapsed days). */
  trailingDays: number;
}

export interface BurnTxn {
  amount: number;
  occurred_at: string;
}

/**
 * Pure shaper — buckets monthly_cap transactions into per-day burn for the cycle
 * and derives the trailing/plan/trend figures. DB-free so it's unit-testable.
 *
 *  - `plannedMonthlyCap` is Σ of the active monthly_cap budget targets (per month).
 *  - Only days that have elapsed (1 … dayOfPeriod) appear; empty days are zero-filled.
 */
export function shapeDailyBurn(
  txns: BurnTxn[],
  period: Period,
  plannedMonthlyCap: number,
  opts: { now: Date; trailingDays?: number },
): DailyBurnResult {
  const { periodLength, dayOfPeriod } = periodProgress(period.start, period.end, opts.now);
  const plannedPerDay = periodLength > 0 ? round2(plannedMonthlyCap / periodLength) : 0;

  // One bucket per elapsed day, indexed by day-of-cycle offset.
  const spendByDay = new Array<number>(dayOfPeriod).fill(0);
  for (const t of txns) {
    const idx = Math.floor((new Date(t.occurred_at).getTime() - period.start.getTime()) / DAY_MS);
    if (idx < 0 || idx >= dayOfPeriod) continue;
    spendByDay[idx] += -Number(t.amount); // outflows negative in DB → positive burn; refunds reduce it
  }

  const days: DailyBurnDay[] = spendByDay.map((spend, i) => ({
    date: toISODate(new Date(period.start.getTime() + i * DAY_MS)),
    spend: round2(spend),
    dayOfCycle: i + 1,
  }));

  const spentSoFar = round2(days.reduce((s, d) => s + d.spend, 0));
  const cyclePerDay = dayOfPeriod > 0 ? round2(spentSoFar / dayOfPeriod) : 0;

  const trailingDays = Math.min(opts.trailingDays ?? DEFAULT_TRAILING_DAYS, dayOfPeriod);
  const avg = (slice: DailyBurnDay[]) =>
    slice.length ? round2(slice.reduce((s, d) => s + d.spend, 0) / slice.length) : 0;

  const trailingPerDay = avg(days.slice(dayOfPeriod - trailingDays));
  const priorPerDay =
    dayOfPeriod >= trailingDays * 2
      ? avg(days.slice(dayOfPeriod - trailingDays * 2, dayOfPeriod - trailingDays))
      : null;

  const vsPlan = round2(trailingPerDay - plannedPerDay);
  const trend = round2(trailingPerDay - (priorPerDay ?? cyclePerDay));

  return {
    cycleStart: toISODate(period.start),
    cycleEnd: toISODate(period.end),
    dayOfPeriod,
    periodLength,
    days,
    plannedPerDay,
    spentSoFar,
    cyclePerDay,
    trailingPerDay,
    priorPerDay,
    vsPlan,
    trend,
    trailingDays,
  };
}

/**
 * Fetch the active monthly_cap budgets + this cycle's transactions in those
 * categories, then shape them. Mirrors getIncomeHistory's self-contained query
 * shape (its own scan, no dependency on computeBudgets).
 */
export async function getDailyBurn(
  supabase: SupabaseClient,
  householdId: string,
  opts: { now?: Date; trailingDays?: number } = {},
): Promise<DailyBurnResult> {
  const now = opts.now ?? new Date();
  const period = defaultPeriod(now);
  const db = scopedDb(supabase, householdId);

  const budgetsRes = await db.budgets
    .select("monthly_target, category_id")
    .eq("kind", "monthly_cap")
    .eq("active", true);
  if (budgetsRes.error) throw new Error(budgetsRes.error.message);

  const capCatIds = (budgetsRes.data ?? [])
    .map((b: any) => b.category_id as string)
    .filter((id: string) => Boolean(id));
  const plannedMonthlyCap = (budgetsRes.data ?? []).reduce(
    (s: number, b: any) => s + Number(b.monthly_target),
    0,
  );

  // No monthly_cap budgets ⇒ nothing to burn; shape an empty series so callers
  // get a well-formed (zeroed) result rather than a crash.
  if (!capCatIds.length) {
    return shapeDailyBurn([], period, 0, { now, trailingDays: opts.trailingDays });
  }

  const rows: any[] = await db.transactions.selectAllPaged((q) =>
    q
      .select("amount, occurred_at")
      .in("category_id", capCatIds)
      .gte("occurred_at", period.start.toISOString())
      .lt("occurred_at", period.end.toISOString())
      .order("occurred_at", { ascending: true }),
  );

  const txns: BurnTxn[] = rows.map((t) => ({ amount: Number(t.amount), occurred_at: t.occurred_at as string }));
  return shapeDailyBurn(txns, period, plannedMonthlyCap, { now, trailingDays: opts.trailingDays });
}
