import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import type { ForecastEvent } from "./events";
import {
  deriveEvents, inferIncomeStreams, nextBillCluster, type CommittedBudget, type CapBudget,
  type MonthlyIncomeFallback,
} from "./events";
import { defaultPeriod, periodProgress, RESERVE_ACCRUAL_START, monthsBetween, rollingWindowStart, ROLLING_PERIODS } from "@/lib/budgets/period";
import { reserveSpendByCat } from "@/lib/budgets/reserves";
import { shadowCommittedByCat, type ShadowBill } from "@/lib/budgets/committed";
import { loadIncomeTxns, loadCommittedWithLastActual, loadCapBudgets, loadIncomeFallback } from "./loaders";
import { walkSeries } from "./walk";
import { normaliseSpendClass } from "@/lib/spend/classify";
import { isRevolvingFacility } from "@/lib/accounts/classify";
import { formatCurrency } from "@/lib/format";

const DAY_MS = 86_400_000;
function iso(d: Date): string { return d.toISOString().slice(0, 10); }

/**
 * What the forecast is based on — surfaced so the UI can show a "what this assumes"
 * panel (and the user can spot a wrong inference). All of it is auto-derived.
 */
export interface ForecastAssumptions {
  /** One entry per detected pay stream (or a single monthly-budget fallback). */
  income: { cadenceDays: number | null; amount: number; lastDate: string | null; source: "inferred" | "fallback" }[];
  /** Combined monthly_cap allowance ÷ cycle length — the daily discretionary drag. */
  dailyBurn: number;
  /** Each committed bill's seeded post-day + amount, and where the seed came from. */
  bills: { name: string; day: number; amount: number; source: "actual" | "target" }[];
}

export interface ForecastResult {
  startBalance: number;
  horizonDays: number;
  series: { date: string; balance: number }[];
  trough: { date: string; balance: number };
  nextPayday: { date: string; amount: number } | null;
  /** The next major bill cluster the verdict is judged against (null => payday fallback). */
  billsDue: { date: string; amount: number; count: number } | null;
  verdict: { makesIt: boolean; margin: number; text: string };
  context: { reservesEarmarked: number; revolvingDrawn: number };
  /** The dated drivers behind the walk (pay/bills/daily burn), date-sorted. */
  events: ForecastEvent[];
  assumptions: ForecastAssumptions;
}

export interface BuildForecastArgs {
  now: Date;
  horizonDays: number;
  startBalance: number;
  events: ForecastEvent[];
  reservesEarmarked: number;
  revolvingDrawn: number;
  assumptions: ForecastAssumptions;
}

function money(n: number): string {
  return formatCurrency(n, { decimals: 0, signDisplay: "never" });
}

/** Walk the everyday balance forward day-by-day, applying each day's net event delta. */
export function buildForecast(args: BuildForecastArgs): ForecastResult {
  const { now, horizonDays, startBalance, events } = args;

  const nextPayday = events
    .filter((e) => e.kind === "income")
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0] ?? null;

  // The forecast walks toward the next major bill cluster (mortgage + bills on the
  // 20th/21st), not the next weekly pay. Only when there are no committed bills at
  // all do we fall back to the old payday anchor.
  const billsDue = nextBillCluster(events, now);

  // series[0] is the end-of-day-0 balance: it equals startBalance only when no event lands on now's date.
  const series = walkSeries(now, horizonDays, startBalance, events);

  const lastDate = series[series.length - 1].date;
  let cutoff: string;
  if (billsDue) {
    // +1 day grace so the post-bills dip (and a straggler that posts the next day)
    // is inside the window; clamp to the last forecast day.
    const graced = iso(new Date(Date.parse(`${billsDue.endDate}T00:00:00Z`) + GRACE_DAYS * DAY_MS));
    cutoff = graced < lastDate ? graced : lastDate;
  } else {
    cutoff = nextPayday ? nextPayday.date : lastDate;
  }
  const window = series.filter((p) => p.date <= cutoff);
  const trough = window.reduce((lo, p) => (p.balance < lo.balance ? p : lo), window[0]);

  const makesIt = trough.balance >= 0;
  const margin = Math.round(trough.balance * 100) / 100;
  const text = billsDue
    ? (makesIt
        ? `You'll cover your bills with ${money(margin)} to spare`
        : `You're ${money(margin)} short of covering your bills`)
    : (makesIt
        ? `You'll clear payday with ${money(margin)} to spare`
        : `You're ${money(margin)} short on the ${troughDayLabel(trough.date)}`);

  return {
    startBalance,
    horizonDays,
    series,
    trough: { date: trough.date, balance: trough.balance },
    nextPayday: nextPayday ? { date: nextPayday.date, amount: nextPayday.delta } : null,
    billsDue: billsDue ? { date: billsDue.date, amount: billsDue.amount, count: billsDue.count } : null,
    verdict: { makesIt, margin, text },
    context: { reservesEarmarked: args.reservesEarmarked, revolvingDrawn: args.revolvingDrawn },
    events,
    assumptions: args.assumptions,
  };
}

function troughDayLabel(date: string): string {
  const day = Number(date.slice(8, 10));
  const suffix = day % 10 === 1 && day !== 11 ? "st"
    : day % 10 === 2 && day !== 12 ? "nd"
    : day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix}`;
}

// Everyday transactional accounts the runway is anchored to: Westpac Everyday +
// ASB Streamline. Resolved by Akahu id so the set is explicit.
export const EVERYDAY_ACCOUNT_IDS = [
  "acc_example_checking", // Westpac Everyday
  "acc_example_savings", // ASB Streamline
] as const;

export function everydayStartBalance(
  accounts: { akahu_account_id: string | null; balance_current: number | null }[],
): number {
  const set = new Set<string>(EVERYDAY_ACCOUNT_IDS);
  return accounts
    .filter((a) => a.akahu_account_id && set.has(a.akahu_account_id))
    .reduce((s, a) => s + Number(a.balance_current ?? 0), 0);
}

/**
 * Merge shadow (unbudgeted recurring) ap_amortised bills into the committed list.
 * Exported as a pure function so it can be unit-tested without a DB stub.
 */
export function appendShadowCommitted(committed: CommittedBudget[], shadowBills: ShadowBill[]): CommittedBudget[] {
  const out = [...committed];
  for (const s of shadowBills) {
    out.push({
      categoryId: s.name,           // CommittedBudget.categoryId is the display name (mirrors existing .map convention)
      kind: "ap_amortised",
      monthlyTarget: s.monthlyAvg,
      lastActualDay: s.lastDay,
      lastActualAmount: s.lastAmount,
      // ShadowBill carries no spend_class; default to the conservative "essential"
      // (an unbudgeted recurring bill can't be wished away by a scenario).
      spendClass: normaliseSpendClass(null),
    });
  }
  return out;
}

const DEFAULT_HORIZON_DAYS = 40; // long enough to always reach the next bill cluster, even the day after one clears
const GRACE_DAYS = 1;            // include the day after the cluster ends in the verdict window

export interface ComputeForecastArgs {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
  horizonDays?: number;
}

/**
 * Fetch everything the forecast needs and compose deriveEvents + buildForecast.
 *  - start balance: everyday accounts (allowlist)
 *  - income txns: last 56 days of income-kind transactions (cadence inference)
 *  - committed: ap_amortised bills only, each seeded with the day-of-month and
 *    amount of its most recent actual posting (reserves are sinking funds spent in
 *    irregular lumps, not scheduled bills — excluded; see reservesEarmarked context)
 *  - caps: monthly_cap budgets (variable burn)
 *  - context: notional reserve accrual total + revolving-credit drawn balance
 */
export async function computeForecast(args: ComputeForecastArgs): Promise<ForecastResult> {
  const { supabase, householdId } = args;
  const db = scopedDb(supabase, householdId);
  // `now` is a wall-clock instant compared against UTC-midnight event dates. On
  // Vercel (UTC) the "exclude today's already-posted txns" boundary is exact; in a
  // non-UTC local dev env a same-day pay/bill could fall either side of the line.
  const now = args.now ?? new Date();
  const horizonDays = args.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const period = defaultPeriod(now);
  const { periodLength, dayOfPeriod } = periodProgress(period.start, period.end, now);

  const [accountsRes, budgetsRes, incomeTxns, categoriesRes] = await Promise.all([
    db.accounts
      .select("akahu_account_id, balance_current, type"),
    db.budgets
      .select("monthly_target, kind, category_id, categories(name, income_type, spend_class)")
      .eq("active", true),
    // Last-56d forward-projecting income inflows — shared with cashflow/compute.ts.
    loadIncomeTxns(db, now),
    // Full select (no filter) is intentional: the categories table is small
    // (one row per budget line), and we need every ap_amortised category to
    // find the unbudgeted ones below.
    db.categories
      .select("id, name, kind"),
  ]);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (budgetsRes.error) throw new Error(budgetsRes.error.message);
  if (categoriesRes.error) throw new Error(categoriesRes.error.message);

  const accounts = (accountsRes.data ?? []) as any[];
  const startBalance = everydayStartBalance(accounts);

  // Revolving-credit drawn balance: the Choices revolving loan account (context only).
  const revolving = accounts.find((a) => a.type === "loan" &&
    isRevolvingFacility(a.akahu_account_id)); // Choices Loan (revolving)
  const revolvingDrawn = revolving ? Number(revolving.balance_current ?? 0) : 0;

  const budgets = (budgetsRes.data ?? []) as any[];

  // Only ap_amortised bills genuinely recur on a schedule, so only they get cloned
  // forward as dated lumps. Reserve budgets are sinking funds spent in irregular
  // lumps — replaying a single last-actual (e.g. a one-off $650 Home Improvement
  // spend) as a fixed monthly bill is algorithmically tidy but pragmatically wrong.
  // Reserve set-aside is already represented as the reservesEarmarked context below.
  const committedBudgets = budgets.filter((b) => b.kind === "ap_amortised");
  const committedCatIds = committedBudgets.map((b) => b.category_id as string);

  // Self-heal: find ap_amortised categories that have NO budget row but recur in the
  // rolling window. They'd otherwise be invisible to the forecast ("fake surplus").
  const cats = (categoriesRes.data ?? []) as any[];
  const budgetedApIds = new Set(committedCatIds);
  const candidateIds = cats
    .filter((c) => c.kind === "ap_amortised" && !budgetedApIds.has(c.id as string))
    .map((c) => c.id as string);

  let shadowBills: ShadowBill[] = [];
  if (candidateIds.length) {
    const rollStart = rollingWindowStart(period.start).toISOString();
    const shadowTxnRes = await db.transactions
      .select("amount, category_id, occurred_at")
      .in("category_id", candidateIds)
      .lt("amount", 0)
      .gte("occurred_at", rollStart)
      .lt("occurred_at", period.end.toISOString());
    if (shadowTxnRes.error) throw new Error(shadowTxnRes.error.message);
    const categoryKind = new Map(cats.map((c) => [c.id as string, { kind: c.kind as string, name: c.name as string }]));
    shadowBills = Array.from(
      shadowCommittedByCat({
        txns: (shadowTxnRes.data ?? []).map((t: any) => ({
          amount: Number(t.amount), category_id: t.category_id as string, occurred_at: t.occurred_at as string,
        })),
        categoryKind,
        budgetedApCatIds: budgetedApIds,
        rollingPeriods: ROLLING_PERIODS,
      }).values(),
    );
  }

  // Budgeted ap_amortised bills (last-actual seeded, shared loader) + the
  // self-healed unbudgeted recurring ("shadow") bills the forecast adds on top.
  const committed: CommittedBudget[] = appendShadowCommitted(
    await loadCommittedWithLastActual(db, committedBudgets, now),
    shadowBills,
  );

  const caps: CapBudget[] = loadCapBudgets(budgets);

  // The monthly-income fallback (used only when no pay stream can be inferred from
  // actuals) ignores irregular/one-off income budgets, so it can't prop up the
  // forecast with income that doesn't recur. Shared loader.
  const incomeFallback: MonthlyIncomeFallback | null = loadIncomeFallback(budgets);

  const reserveCatIds = budgets.filter((b) => b.kind === "reserve").map((b) => b.category_id as string);
  const reserveTargets = budgets.filter((b) => b.kind === "reserve")
    .reduce((s, b) => s + Number(b.monthly_target), 0);
  // Mirror budgets/compute.ts reserve balance: accrue monthly_target from the fixed
  // start (whole months to period.start + the elapsed fraction of the current cycle)
  // and net out real spend since then, so "earmarked" reflects what's actually left
  // in the pot — not the gross set-aside — and stays consistent with the budgets page.
  const monthsElapsed = Math.max(0, monthsBetween(RESERVE_ACCRUAL_START, period.start) + dayOfPeriod / periodLength);
  const reserveSpend = await reserveSpendByCat(db, reserveCatIds, period.end);
  const reservesSpent = reserveCatIds.reduce((s, cat) => s + (reserveSpend.get(cat) ?? 0), 0);
  const reservesEarmarked = reserveTargets * monthsElapsed - reservesSpent;

  const events = deriveEvents({
    now, horizonDays, cycleLength: periodLength,
    incomeTxns, incomeFallback, committed, caps,
  });

  // Assumptions panel: the same inferences deriveEvents makes internally, surfaced
  // so the UI can show "what this is based on" and the user can catch a bad input.
  const streams = inferIncomeStreams(incomeTxns, now);
  const assumptions: ForecastAssumptions = {
    income: streams.length
      ? streams.map((s) => ({ cadenceDays: s.intervalDays, amount: s.amount, lastDate: iso(s.lastDate), source: "inferred" as const }))
      : [{ cadenceDays: null, amount: incomeFallback?.amount ?? 0, lastDate: null, source: "fallback" as const }],
    dailyBurn: periodLength > 0
      ? Math.round((caps.reduce((s, c) => s + c.monthlyTarget, 0) / periodLength) * 100) / 100
      : 0,
    bills: committed.map((b) => ({
      name: b.categoryId,
      day: b.lastActualDay ?? 1,
      amount: b.lastActualAmount ?? b.monthlyTarget,
      source: b.lastActualDay != null ? "actual" : "target",
    })),
  };

  return buildForecast({ now, horizonDays, startBalance, events, reservesEarmarked, revolvingDrawn, assumptions });
}
