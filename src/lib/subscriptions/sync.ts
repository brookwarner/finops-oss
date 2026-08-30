import type { SupabaseClient } from "@supabase/supabase-js";
import { detectSubscriptions, type DetectResult, type DetectTxn } from "./detect";
import { scopedDb } from "@/lib/supabase/scoped";

const LOOKBACK_MONTHS = 18;

// Categories whose recurring charges count as discretionary "subscriptions".
// Bills (insurance/utilities/rates/mortgage) and variable spend (groceries/fuel)
// live in other categories and are intentionally excluded.
export const SUBSCRIPTION_CATEGORIES = ["Online Services"];

export interface ExistingSub {
  id: string;
  merchant_key: string;
  last_duplicate_window: string | null;
}

export interface SubUpsert {
  household_id: string;
  merchant_key: string;
  display_name: string;
  category_id: string | null;
  cadence: string;
  amount: number;
  amount_min: number;
  amount_max: number;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  next_expected: string;
  status: "active" | "lapsed";
  last_duplicate_window: string | null;
  updated_at: string;
}

export interface SyncPlan {
  upserts: SubUpsert[];
  removedKeys: string[];
}

/** Pure: given detection output + existing rows, produce the DB plan. */
export function buildSyncPlan(
  householdId: string,
  detected: DetectResult,
  existing: ExistingSub[],
  opts: { now?: Date },
): SyncPlan {
  const nowISO = (opts.now ?? new Date()).toISOString();
  const dupWindowByKey = new Map<string, string>();
  for (const d of detected.duplicates) {
    const prev = dupWindowByKey.get(d.merchantKey);
    if (!prev || d.windowStart > prev) dupWindowByKey.set(d.merchantKey, d.windowStart);
  }

  const upserts: SubUpsert[] = detected.subscriptions.map((s) => ({
    household_id: householdId,
    merchant_key: s.merchantKey,
    display_name: s.displayName,
    category_id: s.categoryId,
    cadence: s.cadence,
    amount: s.amount,
    amount_min: s.amountMin,
    amount_max: s.amountMax,
    occurrences: s.occurrences,
    first_seen: s.firstSeen,
    last_seen: s.lastSeen,
    next_expected: s.nextExpected,
    status: s.status,
    last_duplicate_window: dupWindowByKey.get(s.merchantKey) ?? null,
    updated_at: nowISO,
  }));

  const detectedKeys = new Set(detected.subscriptions.map((s) => s.merchantKey));
  const removedKeys = existing.filter((e) => !detectedKeys.has(e.merchant_key)).map((e) => e.merchant_key);

  return { upserts, removedKeys };
}

/** I/O wrapper: load history + existing rows, build plan, write it. */
export async function syncSubscriptions(
  supabase: SupabaseClient,
  householdId: string,
  now: Date = new Date(),
): Promise<{ count: number }> {
  const db = scopedDb(supabase, householdId);
  const since = new Date(now);
  since.setMonth(since.getMonth() - LOOKBACK_MONTHS);

  // Resolve the eligible (discretionary subscription) category ids up front and
  // query ONLY those transactions. Filtering at the query level — rather than
  // fetching all spend and filtering in JS — keeps the row count well under
  // PostgREST's 1000-row default cap (all-spend was ~2600 rows over 18 months and
  // was being silently truncated to 1000, dropping subscriptions). Category names
  // are resolved without a household filter so per-household duplicates all match;
  // the transaction household_id + category_id filters scope correctly regardless.
  const { data: catRows, error: catErr } = await supabase
    // scoped-db-exempt: intentionally cross-household — resolves the subscription
    // category ids by NAME only so per-household duplicates all match; the
    // transactions query below re-scopes by household_id + category_id.
    .from("categories")
    .select("id, kind")
    .in("name", SUBSCRIPTION_CATEGORIES);
  if (catErr) throw new Error(`subs categories load: ${catErr.message}`);
  const eligibleCats = (catRows ?? []) as { id: string; kind: string | null }[];
  if (eligibleCats.length === 0) return { count: 0 };
  const kindById = new Map(eligibleCats.map((c) => [c.id, c.kind]));
  const eligibleIds = eligibleCats.map((c) => c.id);

  const { data: rows, error } = await db.transactions
    .select("id, occurred_at, amount, merchant, description, category_id")
    .gte("occurred_at", since.toISOString())
    .lt("amount", 0)
    .in("category_id", eligibleIds);
  if (error) throw new Error(`subs load: ${error.message}`);

  const txns: DetectTxn[] = (rows ?? []).map((r: any) => ({
    id: r.id,
    occurred_at: r.occurred_at,
    amount: Number(r.amount),
    merchant: r.merchant,
    description: r.description,
    category_id: r.category_id,
    categoryKind: kindById.get(r.category_id) ?? null,
  }));

  const { data: existingRows } = await db.subscriptions
    .select("id, merchant_key, last_duplicate_window");
  const existing = (existingRows ?? []) as ExistingSub[];
  const tableWasEmpty = existing.length === 0;

  const detected = detectSubscriptions(txns, now);
  const plan = buildSyncPlan(householdId, detected, existing, { now });

  if (plan.upserts.length > 0) {
    const { data: upserted, error: upErr } = await db.subscriptions
      .upsert(plan.upserts, { onConflict: "household_id,merchant_key" })
      .select("id, merchant_key");
    if (upErr) throw new Error(`subs upsert: ${upErr.message}`);

    // On the very first sync, pre-seed baseline alert markers so
    // loadSubscriptionSignals finds them and never fires alerts for the
    // initial backfill cohort. These rows are delivered:true so they never
    // surface as pending, and carry payload.backfill for provenance.
    // We write both subscription_new and (where applicable) subscription_duplicate
    // markers so the duplicate-dedup contract is symmetric with new-sub suppression.
    if (tableWasEmpty && upserted && upserted.length > 0) {
      const windowByKey = new Map(plan.upserts.map((u) => [u.merchant_key, u.last_duplicate_window]));
      const markers: Record<string, unknown>[] = [];
      for (const row of upserted) {
        markers.push({
          household_id: householdId,
          type: "subscription_new",
          subscription_id: row.id,
          title: "Subscription baseline",
          body: "Recorded at first detection (no alert sent).",
          payload: { backfill: true },
          delivered: true,
          fired_at: now.toISOString(),
        });
        const win = windowByKey.get(row.merchant_key);
        if (win) {
          markers.push({
            household_id: householdId,
            type: "subscription_duplicate",
            subscription_id: row.id,
            period_start: win,
            title: "Duplicate baseline",
            body: "Historical duplicate window recorded at first detection (no alert sent).",
            payload: { backfill: true },
            delivered: true,
            fired_at: now.toISOString(),
          });
        }
      }
      const { error: markerErr } = await db.alerts.insert(markers);
      if (markerErr) console.error("[subs] backfill marker insert failed", markerErr.message);
    }
  }

  if (plan.removedKeys.length > 0) {
    const { error: delErr } = await db.subscriptions
      .delete()
      .in("merchant_key", plan.removedKeys);
    if (delErr) throw new Error(`subs prune: ${delErr.message}`);
  }

  return { count: plan.upserts.length };
}
