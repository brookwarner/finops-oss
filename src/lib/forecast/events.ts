// src/lib/forecast/events.ts

import type { SpendClass } from "@/lib/spend/classify";

export type ForecastBudgetKind = "monthly_cap" | "reserve" | "ap_amortised" | "income";

export interface IncomeTxn {
  occurred_at: string;
  amount: number; // signed; income inflows are positive
  description?: string | null; // payer/source text; used to separate income streams
}

export interface IncomeCadence {
  intervalDays: number; // median days between pays
  amount: number;       // median pay amount
  lastDate: Date;       // most recent income date
}

/** A single income stream (one payer) with its own inferred cadence. */
export interface IncomeStream extends IncomeCadence {
  key: string; // normalised payer key (see incomeStreamKey)
}

// Income under this magnitude isn't pay — it's interest/cashback/PIE-tax returns.
// Excluding it stops sub-dollar entries from spawning phantom pay streams and
// (more importantly) from crushing the median pay interval to near-zero.
const INCOME_NOISE_FLOOR = 95;

/**
 * Normalise an income transaction's description to a stable per-payer key so that
 * separate income streams (salary vs. wages vs. interest) can be told apart and
 * each given its own cadence. Lowercases, strips digits/punctuation, and keeps the
 * first few alpha tokens — robust to the amount/date noise banks append.
 */
export function incomeStreamKey(description: string | null | undefined): string {
  return (description ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

/**
 * Split income transactions by payer and infer a cadence for each stream
 * independently, dropping sub-floor noise (interest/cashback) and any stream with
 * too few points to establish a rhythm. Replaces the old single-cadence inference,
 * which conflated interleaved streams into a nonsense "paid every couple of days".
 */
export function inferIncomeStreams(
  txns: IncomeTxn[],
  now: Date,
  noiseFloor = INCOME_NOISE_FLOOR,
): IncomeStream[] {
  const groups = new Map<string, IncomeTxn[]>();
  for (const t of txns) {
    if (Math.abs(t.amount) < noiseFloor) continue; // drop noise before it skews a stream
    const key = incomeStreamKey(t.description);
    const g = groups.get(key);
    if (g) g.push(t); else groups.set(key, [t]);
  }
  const streams: IncomeStream[] = [];
  for (const [key, group] of groups) {
    const cadence = inferIncomeCadence(group, now);
    if (!cadence || Math.abs(cadence.amount) < noiseFloor) continue;
    streams.push({ ...cadence, key });
  }
  return streams;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const DAY_MS = 86_400_000;

/**
 * Infer pay cadence from recent income-kind transactions. Median interval and
 * median amount are robust to a one-off missed/early pay. Returns null when
 * there are too few data points to establish a rhythm (caller falls back to the
 * income budget's monthly target).
 *
 * `_now` is intentionally unused: recency-windowing is the caller's
 * responsibility (the DB orchestrator queries only the last ~56 days of income
 * transactions before calling this). The parameter is kept for API symmetry
 * with the other projection/derive helpers and reserved for future use.
 */
export function inferIncomeCadence(txns: IncomeTxn[], _now: Date): IncomeCadence | null {
  if (txns.length < 2) return null;
  const dates = txns
    .map((t) => new Date(t.occurred_at))
    .sort((a, b) => a.getTime() - b.getTime());
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    intervals.push(Math.round((dates[i].getTime() - dates[i - 1].getTime()) / DAY_MS));
  }
  const intervalDays = Math.max(1, Math.round(median(intervals)));
  const amount = Math.round(median(txns.map((t) => t.amount)));
  return { intervalDays, amount, lastDate: dates[dates.length - 1] };
}

export interface ForecastEvent {
  date: string;                                   // YYYY-MM-DD
  delta: number;                                  // signed: +inflow, -outflow
  label: string;
  kind: "income" | "committed" | "variable";
}

/** A contiguous run of committed bills the forecast treats as one "bills day". */
export interface BillCluster {
  date: string;     // first bill date in the cluster (display anchor — "the 20th")
  endDate: string;  // last bill date in the cluster (drives the verdict cutoff)
  amount: number;   // total outflow magnitude across the cluster
  count: number;    // number of bills in the cluster
}

// Bills landing within this many days of each other are one cluster: the 20th and
// 21st (mortgage) fold together; a stray bill on the 27th does not.
export const CLUSTER_GAP_DAYS = 3;

/**
 * The next "bills day" the forecast walks toward: the upcoming committed-bill
 * cluster with the largest total outflow. The biggest cluster wins — NOT the
 * earliest bill — so a tiny stray charge earlier in the month never masquerades as
 * bills day (on the 7th the earliest committed bill is an $18 phone bill on the
 * 27th; the real stressor is the ~$5.6k 20th/21st cluster). Returns null when there
 * are no future committed bills, so the caller can fall back to payday anchoring.
 */
export function nextBillCluster(
  events: ForecastEvent[],
  now: Date,
  gapDays = CLUSTER_GAP_DAYS,
): BillCluster | null {
  const today = iso(now);
  const bills = events
    .filter((e) => e.kind === "committed" && e.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (bills.length === 0) return null;

  const dayGap = (a: string, b: string) =>
    Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

  const clusters: BillCluster[] = [];
  let cur: BillCluster | null = null;
  let prevDate = "";
  for (const e of bills) {
    if (cur && dayGap(prevDate, e.date) <= gapDays) {
      cur.endDate = e.date;
      cur.amount += Math.abs(e.delta);
      cur.count += 1;
    } else {
      cur = { date: e.date, endDate: e.date, amount: Math.abs(e.delta), count: 1 };
      clusters.push(cur);
    }
    prevDate = e.date;
  }
  // Largest total outflow wins; ties break to the earliest (clusters is date-sorted).
  return clusters.reduce((best, c) => (c.amount > best.amount ? c : best), clusters[0]);
}

/** Monthly income fallback when cadence can't be inferred. */
export interface MonthlyIncomeFallback {
  day: number;    // day-of-month the income budget posts
  amount: number;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Day-of-month event date within the same month as `ref`, clamped to month length. */
function dateOnDayOfMonth(ref: Date, day: number): Date {
  const last = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), Math.min(day, last)));
}

/**
 * Project income events across the horizon. Prefers an inferred cadence
 * (weekly pay), else a monthly income-budget fallback, else nothing.
 */
export function projectIncomeEvents(
  cadence: IncomeCadence | null,
  fallback: MonthlyIncomeFallback | null,
  now: Date,
  horizonDays: number,
): ForecastEvent[] {
  const end = new Date(now.getTime() + horizonDays * DAY_MS);
  const events: ForecastEvent[] = [];
  if (cadence) {
    let d = new Date(cadence.lastDate.getTime() + cadence.intervalDays * DAY_MS);
    while (d <= end) {
      if (d > now) events.push({ date: iso(d), delta: cadence.amount, label: "Pay", kind: "income" });
      d = new Date(d.getTime() + cadence.intervalDays * DAY_MS);
    }
    return events;
  }
  if (fallback) {
    // +1 guards against month-length variance so the horizon is always covered.
    const months = Math.ceil(horizonDays / 28) + 1;
    for (let m = 0; m <= months; m++) {
      const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
      const d = dateOnDayOfMonth(ref, fallback.day);
      if (d > now && d <= end) {
        events.push({ date: iso(d), delta: fallback.amount, label: "Pay", kind: "income" });
      }
    }
  }
  return events;
}

export interface CommittedBudget {
  categoryId: string;
  kind: "ap_amortised" | "reserve";
  monthlyTarget: number;
  lastActualDay: number | null;    // day-of-month of most recent actual posting
  lastActualAmount: number | null; // outflow magnitude (positive) of that posting
  spendClass: SpendClass;
}

/**
 * One outflow event per month for each committed bill, placed on the day-of-month
 * of its most recent actual posting (last-actual seeding), amount = that actual
 * (fallback monthly_target on the 1st when there's no clean recent posting).
 * Committed bills are lumpy and never run-rated.
 */
export function projectCommittedEvents(
  budgets: CommittedBudget[],
  now: Date,
  horizonDays: number,
): ForecastEvent[] {
  const end = new Date(now.getTime() + horizonDays * DAY_MS);
  const events: ForecastEvent[] = [];
  for (const b of budgets) {
    const day = b.lastActualDay ?? 1;
    const amount = b.lastActualAmount ?? b.monthlyTarget;
    // +1 guards against month-length variance so the horizon is always covered.
    const months = Math.ceil(horizonDays / 28) + 1;
    for (let m = 0; m <= months; m++) {
      const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
      const d = dateOnDayOfMonth(ref, day);
      if (d >= now && d < end) {
        events.push({
          date: iso(d),
          delta: -Math.abs(amount),
          label: `bill:${b.categoryId}`,
          kind: "committed",
        });
      }
    }
  }
  return events;
}

export interface CapBudget {
  categoryId: string;
  monthlyTarget: number;
  /**
   * Carried for symmetry with ActualCap and to avoid fixture churn if this
   * field is used in future. projectVariableBurn intentionally ignores it —
   * the on-budget line sums ALL caps at their monthly target regardless of
   * class, because on-budget means all categories are running to plan.
   */
  spendClass: SpendClass;
}

/**
 * Spread the combined monthly_cap allowance as one equal daily outflow per day
 * across the horizon (the discretionary drag). Only genuinely variable spend is
 * run-rated this way; committed bills are dated lumps (see projectCommittedEvents).
 */
export function projectVariableBurn(
  caps: CapBudget[],
  cycleLength: number,
  now: Date,
  horizonDays: number,
): ForecastEvent[] {
  if (caps.length === 0 || cycleLength <= 0) return [];
  const perDay = caps.reduce((s, c) => s + c.monthlyTarget, 0) / cycleLength;
  if (perDay <= 0) return [];
  const events: ForecastEvent[] = [];
  for (let i = 1; i <= horizonDays; i++) {
    const d = new Date(now.getTime() + i * DAY_MS);
    events.push({ date: iso(d), delta: -Math.round(perDay * 100) / 100, label: "Daily spend", kind: "variable" });
  }
  return events;
}

export interface ActualCap {
  categoryId: string;
  dailyActual: number;     // trailing-window spend ÷ window days, per category
  spendClass: SpendClass;
}

/** Variable burn from ACTUAL trailing spend, one equal daily outflow per category
 *  across the horizon. `discretionaryFactor` scales discretionary categories
 *  (1 = full, 0 = paused); essential categories are always full. */
export function projectActualBurn(
  caps: ActualCap[],
  now: Date,
  horizonDays: number,
  discretionaryFactor = 1,
): ForecastEvent[] {
  const perDay = caps.reduce((s, c) => {
    const f = c.spendClass === "discretionary" ? Math.max(0, discretionaryFactor) : 1;
    return s + c.dailyActual * f;
  }, 0);
  if (perDay <= 0) return [];
  const events: ForecastEvent[] = [];
  for (let i = 1; i <= horizonDays; i++) {
    const d = new Date(now.getTime() + i * DAY_MS);
    events.push({ date: iso(d), delta: -Math.round(perDay * 100) / 100, label: "Daily spend", kind: "variable" });
  }
  return events;
}

export interface DeriveEventsArgs {
  now: Date;
  horizonDays: number;
  cycleLength: number;
  incomeTxns: IncomeTxn[];
  incomeFallback: MonthlyIncomeFallback | null;
  committed: CommittedBudget[];
  caps: CapBudget[];
}

/** Compose all event sources into a single date-sorted forecast event list. */
export function deriveEvents(args: DeriveEventsArgs): ForecastEvent[] {
  const streams = inferIncomeStreams(args.incomeTxns, args.now);
  // Project each detected pay stream on its own cadence. Fall back to the monthly
  // income budget only when no stream could be inferred at all.
  const income = streams.length
    ? streams.flatMap((s) => projectIncomeEvents(s, null, args.now, args.horizonDays))
    : projectIncomeEvents(null, args.incomeFallback, args.now, args.horizonDays);
  const events = [
    ...income,
    ...projectCommittedEvents(args.committed, args.now, args.horizonDays),
    ...projectVariableBurn(args.caps, args.cycleLength, args.now, args.horizonDays),
  ];
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
