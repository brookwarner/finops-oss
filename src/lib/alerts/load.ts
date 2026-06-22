// Data loading + the pure compute→snapshot mapper. The mapper is unit-tested
// (load.test.ts); the supabase-backed loaders are thin glue exercised end-to-end
// via the cron route and the verification checklist.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";
import type { BudgetComputeResult, BudgetStatusRow } from "@/lib/budgets/compute";
import type { BudgetSnapshot, ThresholdState } from "./evaluate";
import type { ReserveTxn } from "./reserve";
import type { AlertRow } from "./run";
import type { NewSubEvent, DuplicateEvent } from "./subscriptions";

const RAG_TO_STATE: Record<string, ThresholdState> = {
  ok: "ok",
  warning: "warning",
  over: "over",
};

/** Pure: map computeBudgets rows to cap snapshots. Only monthly_cap budgets. */
export function capSnapshotsFromRows(rows: BudgetStatusRow[], daysLeft: number): BudgetSnapshot[] {
  return rows
    .filter((r) => r.kind === "monthly_cap")
    .map((r) => ({
      categoryId: r.categoryId,
      category: r.category,
      state: RAG_TO_STATE[r.status],
      target: r.target,
      netSpent: r.netSpent,
      pct: r.pct,
      remaining: r.remaining,
      daysLeft,
    }));
}

const CAP_STATE_TYPES = ["cap_breach", "cap_warning", "cap_ok"];

/** Latest recorded threshold state per cap category within the current period. */
export async function loadLastStates(
  supabase: SupabaseClient,
  householdId: string,
  periodStart: string,
): Promise<Map<string, ThresholdState>> {
  const { data, error } = await scopedDb(supabase, householdId).alerts
    .select("category_id, state, fired_at")
    .eq("period_start", periodStart)
    .in("type", CAP_STATE_TYPES)
    .order("fired_at", { ascending: false });
  if (error) throw new Error(error.message);

  const map = new Map<string, ThresholdState>();
  for (const r of data ?? []) {
    // Rows arrive newest-first, so the first time we see a category is its latest.
    if (r.category_id && !map.has(r.category_id) && r.state) {
      map.set(r.category_id, r.state as ThresholdState);
    }
  }
  return map;
}

/** Reserve-category transactions in the poll window, with the fund's balance attached. */
export async function loadReserveTxns(
  supabase: SupabaseClient,
  householdId: string,
  sinceISO: string,
  compute: BudgetComputeResult,
): Promise<ReserveTxn[]> {
  const balanceByCat = new Map<string, number | null>();
  for (const r of compute.rows) {
    if (r.kind === "reserve") balanceByCat.set(r.categoryId, r.reserveBalance);
  }
  if (balanceByCat.size === 0) return [];

  const { data, error } = await scopedDb(supabase, householdId).transactions
    .select("id, amount, category_id, occurred_at, merchant, categories(name, kind)")
    .gte("occurred_at", sinceISO)
    .not("category_id", "is", null)
    .order("occurred_at", { ascending: false });
  if (error) throw new Error(error.message);

  const out: ReserveTxn[] = [];
  for (const t of data ?? []) {
    const cat = getFirstNested((t as any).categories);
    if (cat?.kind !== "reserve") continue;
    out.push({
      id: t.id,
      categoryId: t.category_id as string,
      category: cat?.name ?? "Reserve",
      amount: Number(t.amount),
      occurredAt: t.occurred_at as string,
      merchant: t.merchant ?? null,
      reserveBalance: balanceByCat.get(t.category_id as string) ?? null,
    });
  }
  return out;
}

/** Transaction ids that already have a reserve_withdrawal alert (dedup set). */
export async function loadAlertedTxnIds(
  supabase: SupabaseClient,
  householdId: string,
): Promise<Set<string>> {
  const { data, error } = await scopedDb(supabase, householdId).alerts
    .select("txn_id")
    .eq("type", "reserve_withdrawal")
    .not("txn_id", "is", null);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r: any) => r.txn_id as string));
}

export async function insertAlerts(supabase: SupabaseClient, rows: AlertRow[]): Promise<void> {
  if (rows.length === 0) return;
  // scoped-db-exempt: rows are pre-built AlertRow[] each already carrying its own
  // household_id (set by the caller from the computed snapshot); no single
  // householdId is in scope here to bind a scopedDb to.
  const { error } = await supabase.from("alerts").insert(rows);
  if (error) throw new Error(error.message);
}

// "New" = an active subscription with no prior subscription_new alert. The first
// backfill sync writes baseline marker alerts (see syncSubscriptions), so the
// initial cohort is suppressed here; only later-appearing subs alert.

/**
 * Gather subscription alert signals for a household: brand-new active subs
 * (never alerted) and current duplicate windows, plus the prior-alert dedup state.
 */
export async function loadSubscriptionSignals(
  supabase: SupabaseClient,
  householdId: string,
): Promise<{
  newSubs: NewSubEvent[];
  duplicates: DuplicateEvent[];
  priorNewKeys: Set<string>;
  priorDuplicateWindows: Map<string, string>;
}> {
  const db = scopedDb(supabase, householdId);
  const { data: subs } = await db.subscriptions
    .select("id, display_name, amount, cadence, next_expected, status, last_duplicate_window")
    .eq("status", "active");

  const { data: priorAlerts } = await db.alerts
    .select("subscription_id, type, period_start")
    .in("type", ["subscription_new", "subscription_duplicate"])
    .not("subscription_id", "is", null);

  const priorNewKeys = new Set<string>();
  const priorDuplicateWindows = new Map<string, string>();
  for (const a of priorAlerts ?? []) {
    if (a.type === "subscription_new" && a.subscription_id) priorNewKeys.add(a.subscription_id);
    if (a.type === "subscription_duplicate" && a.subscription_id && a.period_start) {
      const cur = priorDuplicateWindows.get(a.subscription_id);
      if (!cur || a.period_start > cur) priorDuplicateWindows.set(a.subscription_id, a.period_start);
    }
  }

  const newSubs: NewSubEvent[] = ((subs ?? []) as any[])
    .filter((s) => !priorNewKeys.has(s.id))
    .map((s) => ({
      id: s.id, displayName: s.display_name, amount: Number(s.amount),
      cadence: s.cadence, nextExpected: s.next_expected,
    }));

  const duplicates: DuplicateEvent[] = ((subs ?? []) as any[])
    .filter((s) => s.last_duplicate_window != null)
    .map((s) => ({
      id: s.id, displayName: s.display_name, amount: Number(s.amount),
      cadence: s.cadence, windowStart: s.last_duplicate_window as string,
    }));

  return { newSubs, duplicates, priorNewKeys, priorDuplicateWindows };
}

export { type BudgetComputeResult };
