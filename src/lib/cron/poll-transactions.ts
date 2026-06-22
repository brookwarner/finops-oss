import { NextResponse } from "next/server";
import type { Transaction } from "akahu";
import { buildAkahuClientFromEnv } from "@/lib/akahu/client";
import { getAkahuUserToken } from "@/lib/akahu/config";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { scopedDb } from "@/lib/supabase/scoped";
import { uniqueHouseholdIds } from "@/lib/accounts/households";
import { getFirstNested } from "@/lib/supabase/relations";
import { extractCategories, normalisePendingTx, normalisePostedTx } from "@/lib/akahu/ingest";
import { categorise, type Rule } from "@/lib/categorise/engine";
import { resolveBankHint } from "@/lib/categorise/bank-hint";
import { INBOX_CUTOFF, POCKETSMITH_BOUNDARY, DEDUP_OVERLAP_WINDOW_DAYS } from "@/lib/constants";
import { planDedupActions, applyDedupActions, isPocketSmithRow, type DedupRow } from "@/lib/dedup/cross-source";
import { planTransferActions, applyTransferActions, type TransferTxn } from "@/lib/transfers/detect";
import { computeBudgets } from "@/lib/budgets/compute";
import { defaultPeriod } from "@/lib/budgets/period";
import { snapshotRecordsFromResult, upsertSnapshots } from "@/lib/budgets/snapshot";

// Daily Akahu polling. Replaces the (now-removed) webhook+drain pipeline.
//
// Window strategy:
//   - backfill: true  -> 365 days (max personal-app history)
//   - default         -> 30 days (rolling overlap catches late posts / re-IDs)
//
// Reconciliation: Akahu may add, modify, or delete transactions within a
// window (~0.1% are re-IDed by banks). We fetch the full window, upsert by
// akahu_transaction_id (refreshing enrichment + last_seen_at on conflict), then
// delete any rows in the window+account not touched this run (mark-and-sweep on
// last_seen_at).
//
// Resilience: per-account and per-transaction work is isolated. A single
// account or transaction failure logs-and-continues and is accumulated into the
// `errors` array of the JSON response, rather than aborting the whole batch.
//
// Pending: wipe + replace per account (no stable IDs).
//
// Lives in lib (not the route module) so both the `/api/cron/poll-transactions`
// GET handler and the user-facing manual-sync route (`/api/sync`) can call it —
// Next.js forbids non-HTTP exports from a route file. The cron GET handler is
// the only `backfill` caller.
export async function runPollTransactions(
  { backfill = false }: { backfill?: boolean } = {},
): Promise<NextResponse> {
  const windowDays = backfill ? 365 : 30;

  const end = new Date();
  const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
  // Captured before any upsert so the mark-and-sweep reconcile can identify rows
  // not touched this run (their last_seen_at stays < runStart).
  const runStart = new Date().toISOString();

  const supabase = createSupabaseServiceClient();
  const akahu = buildAkahuClientFromEnv();
  const token = await getAkahuUserToken();

  // Per-account / per-step failures accumulate here instead of aborting the run.
  const errors: Array<{ scope: string; ref?: string; error: string }> = [];

  // 1. Load our accounts. Filter to those with TRANSACTIONS attribute.
  // scoped-db-exempt: poll cron enumerates EVERY household's accounts, then scopes
  // all downstream reads/writes per-household (hhId loops below).
  const { data: ourAccounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, household_id, akahu_account_id, attributes");
  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 });
  if (!ourAccounts || ourAccounts.length === 0) {
    return NextResponse.json({ posted: 0, pending: 0, skipped: "no accounts" });
  }
  const txnCapable = ourAccounts.filter(
    (a) => Array.isArray(a.attributes) && a.attributes.includes("TRANSACTIONS"),
  );
  const accountByAkahuId = new Map(txnCapable.map((a) => [a.akahu_account_id, a]));

  // 2. Paginate /v1/transactions for the full window.
  const fetched: Transaction[] = [];
  try {
    let cursor: string | undefined;
    do {
      const page = await akahu.transactions.list(token, {
        start: start.toISOString(),
        end: end.toISOString(),
        cursor,
      });
      fetched.push(...page.items);
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
  } catch (e) {
    // A pagination failure can leave a partial window. Continue processing what
    // we have, but skip the reconcile-delete (would falsely drop unseen rows).
    const message = e instanceof Error ? e.message : String(e);
    console.error("[poll-transactions] akahu pagination failed", message);
    errors.push({ scope: "akahu_pagination", error: message });
  }
  // If pagination aborted mid-window, a reconcile delete could wipe legitimate
  // rows that simply weren't re-fetched. Only reconcile when the fetch completed.
  const fetchComplete = !errors.some((e) => e.scope === "akahu_pagination");

  // 3. Lazy-seed any categories encountered.
  const cats = extractCategories(fetched);
  if (cats.length > 0) {
    const { error: catSeedErr } = await supabase.from("akahu_categories").upsert(cats);
    if (catSeedErr) {
      console.error("[poll-transactions] category seed failed", catSeedErr.message);
      errors.push({ scope: "category_seed", error: catSeedErr.message });
    }
  }

  // 4. Upsert posted, tracked per account for reconciliation. One failed txn
  //    logs-and-continues rather than aborting the batch.
  const seenByAccount = new Map<string, Set<string>>();
  let postedCount = 0;
  for (const t of fetched) {
    const acct = accountByAkahuId.get(t._account);
    if (!acct) continue;
    const seen = seenByAccount.get(acct.id) ?? new Set<string>();
    seen.add(t._id);
    seenByAccount.set(acct.id, seen);

    const row = normalisePostedTx(t, { householdId: acct.household_id, accountId: acct.id });
    // scoped-db-exempt: per-account upsert keyed on the globally-unique
    // akahu_transaction_id; row carries the account's household_id.
    const { error } = await supabase
      .from("transactions")
      .upsert(row, { onConflict: "akahu_transaction_id" });
    if (error) {
      console.error("[poll-transactions] upsert posted failed", t._id, error.message);
      errors.push({ scope: "upsert_posted", ref: t._id, error: error.message });
      continue;
    }
    postedCount++;
  }

  // 4a. Cross-source dedup: a transaction present in both the PocketSmith
  // import and the live Akahu feed. Keep Akahu, port the PS category, drop PS.
  // Scans the whole overlap window each run, so a backfill run also sweeps
  // pre-existing dups. See lib/dedup/cross-source.ts. Isolated per household.
  const DAY = 24 * 60 * 60 * 1000;
  const boundaryMs = new Date(POCKETSMITH_BOUNDARY).getTime();
  const ovStart = new Date(boundaryMs - DEDUP_OVERLAP_WINDOW_DAYS * DAY).toISOString();
  const ovEnd = new Date(boundaryMs + DEDUP_OVERLAP_WINDOW_DAYS * DAY).toISOString();
  const dedupHouseholds = uniqueHouseholdIds(txnCapable);
  let dedupAuto = 0;
  let dedupFlagged = 0;
  for (const hhId of dedupHouseholds) {
    try {
      const { data: ovRows, error: ovErr } = await scopedDb(supabase, hhId).transactions
        .select("id, akahu_transaction_id, household_id, account_id, occurred_at, amount, description, category_id, is_manual_category")
        .gte("occurred_at", ovStart)
        .lte("occurred_at", ovEnd);
      if (ovErr) throw new Error(ovErr.message);
      const all = (ovRows ?? []) as DedupRow[];
      const psRows = all.filter(isPocketSmithRow);
      if (psRows.length === 0) continue;
      const akRows = all.filter((r) => !isPocketSmithRow(r));
      const actions = planDedupActions(akRows, psRows);
      await applyDedupActions(supabase, actions);
      dedupAuto += actions.filter((a) => a.kind === "resolve").length;
      dedupFlagged += actions.filter((a) => a.kind === "flag").length;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[poll-transactions] dedup failed", hhId, message);
      errors.push({ scope: "dedup", ref: hhId, error: message });
    }
  }

  // 4b. Auto-categorise. Load rules per household once, sweep uncategorised
  // (and non-manual) rows in the touched windows, apply engine, update.
  // scoped-db-exempt: categories loaded across all households for name/kind lookup;
  // the per-household transaction sweeps below re-scope by household_id.
  const { data: catRows, error: catErr } = await supabase
    .from("categories")
    .select("id, name, group, kind");
  if (catErr) {
    return NextResponse.json({ error: "categories load failed", details: catErr.message }, { status: 500 });
  }
  const bankHint = resolveBankHint(catRows ?? []);
  const transfersCat = (catRows ?? []).find(
    (c: any) => c.name === "Transfers" && c.group === "System",
  );
  const catKindById = new Map<string, string | null>((catRows ?? []).map((c: any) => [c.id, c.kind ?? null]));

  const householdIds = uniqueHouseholdIds(txnCapable);
  let categorisedCount = 0;
  for (const hhId of householdIds) {
    try {
      const hdb = scopedDb(supabase, hhId);
      const { data: rulesRows, error: rulesErr } = await hdb.category_rules
        .select("id, category_id, match_type, match_value, field, priority, source, min_amount, max_amount")
        .order("priority", { ascending: true });
      if (rulesErr) throw new Error(`rules load failed: ${rulesErr.message}`);
      const rules = (rulesRows ?? []) as Rule[];

      const { data: pending, error: pendErr } = await hdb.transactions
        .select("id, merchant, description, amount, is_manual_category, akahu_categories(name)")
        .is("category_id", null)
        .eq("is_manual_category", false)
        .gte("occurred_at", INBOX_CUTOFF);
      if (pendErr) throw new Error(`txn fetch failed: ${pendErr.message}`);

      for (const tx of pending ?? []) {
        const ac = getFirstNested(tx.akahu_categories);
        const result = categorise(
          {
            id: tx.id,
            merchant: tx.merchant,
            description: tx.description,
            is_manual_category: tx.is_manual_category,
            akahu_category_name: ac?.name ?? null,
            amount: tx.amount,
          },
          rules,
          bankHint,
        );
        if (!result) continue;
        // scoped-db-exempt: by-PK update on a tx id sourced from this household's
        // own scoped `pending` read above.
        const { error: upErr } = await supabase
          .from("transactions")
          .update({ category_id: result.category_id, needs_review: result.needs_review })
          .eq("id", tx.id);
        if (upErr) {
          console.error("[poll-transactions] categorise update failed", tx.id, upErr.message);
          errors.push({ scope: "categorise_update", ref: tx.id, error: upErr.message });
          continue;
        }
        categorisedCount++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[poll-transactions] categorise failed", hhId, message);
      errors.push({ scope: "categorise", ref: hhId, error: message });
    }
  }

  // 4c. Internal transfer detection (ingest mode): uncategorised opposite-leg
  // pairs across the household's own accounts -> Transfers. Never touches
  // already-categorised rows, so mortgage P&I (ap_amortised) is protected.
  let transfersTagged = 0;
  if (transfersCat) {
    for (const hhId of householdIds) {
      try {
        const { data: recent, error: trErr } = await scopedDb(supabase, hhId).transactions
          .select("id, household_id, account_id, occurred_at, amount, description, category_id")
          .gte("occurred_at", start.toISOString())
          .lte("occurred_at", end.toISOString());
        if (trErr) throw new Error(trErr.message);
        const txns: TransferTxn[] = (recent ?? []).map((t: any) => ({
          id: t.id, household_id: t.household_id, account_id: t.account_id,
          occurred_at: t.occurred_at, amount: t.amount, description: t.description,
          category_id: t.category_id, category_kind: t.category_id ? (catKindById.get(t.category_id) ?? null) : null,
        }));
        const actions = planTransferActions(txns, { mode: "ingest", transfersCategoryId: transfersCat.id });
        await applyTransferActions(supabase, actions);
        transfersTagged += actions.length;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[poll-transactions] transfer detect failed", hhId, message);
        errors.push({ scope: "transfers", ref: hhId, error: message });
      }
    }
  }

  // 5. Reconcile deletes within the window for accounts we polled. Mark-and-sweep
  //    on last_seen_at: every row touched this run had last_seen_at refreshed to
  //    >= runStart by the upsert, so anything still < runStart (or null) in the
  //    window for a polled account was not seen this run and is reconciled away.
  //    Skipped entirely if pagination was incomplete (would drop live rows).
  let deletedCount = 0;
  if (fetchComplete) {
    for (const accountId of seenByAccount.keys()) {
      try {
        // scoped-db-exempt: reconcile sweep keyed by account_id (account already
        // enumerated above); deletes only rows untouched this run in the window.
        const { data: dropped, error } = await supabase
          .from("transactions")
          .delete()
          .eq("account_id", accountId)
          .gte("occurred_at", start.toISOString())
          .lte("occurred_at", end.toISOString())
          .lt("last_seen_at", runStart)
          .select("id");
        if (error) throw new Error(error.message);
        deletedCount += dropped?.length ?? 0;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[poll-transactions] reconcile delete failed", accountId, message);
        errors.push({ scope: "reconcile_delete", ref: accountId, error: message });
      }
    }
  }

  // 6. Pending: wipe + replace. Listing pending across all accounts for the token.
  let pendingCount = 0;
  try {
    const pending = await akahu.transactions.listPending(token);
    const txnCapableIds = txnCapable.map((a) => a.id);
    if (txnCapableIds.length > 0) {
      // scoped-db-exempt: pending wipe+replace keyed by the enumerated account ids.
      const { error: pendDelErr } = await supabase
        .from("pending_transactions")
        .delete()
        .in("account_id", txnCapableIds);
      if (pendDelErr) throw new Error(`pending wipe failed: ${pendDelErr.message}`);
    }
    for (const p of pending) {
      const acct = accountByAkahuId.get(p._account);
      if (!acct) continue;
      const row = normalisePendingTx(p, { householdId: acct.household_id, accountId: acct.id });
      // scoped-db-exempt: pending insert; row carries the account's household_id.
      const { error } = await supabase.from("pending_transactions").insert(row);
      if (error) {
        console.error("[poll-transactions] insert pending failed", p._account, error.message);
        errors.push({ scope: "insert_pending", ref: p._account, error: error.message });
        continue;
      }
      pendingCount++;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[poll-transactions] pending sync failed", message);
    errors.push({ scope: "pending_sync", error: message });
  }

  // 7. Mark accounts as polled.
  const now = new Date().toISOString();
  for (const a of txnCapable) {
    // scoped-db-exempt: by-PK account flag update during the all-household enumeration.
    const { error: markErr } = await supabase
      .from("accounts")
      .update({ refreshed_transactions_at: now })
      .eq("id", a.id);
    if (markErr) {
      console.error("[poll-transactions] mark polled failed", a.id, markErr.message);
      errors.push({ scope: "mark_polled", ref: a.id, error: markErr.message });
    }
  }

  // Refresh the current cycle's budget snapshot (provisional until it rolls past
  // the 20th, then it freezes into the historical record). Best-effort: a failure
  // here must not fail the ingest run.
  let snapshots = 0;
  try {
    const households = uniqueHouseholdIds(ourAccounts);
    const period = defaultPeriod(new Date());
    for (const householdId of households) {
      const result = await computeBudgets({ supabase, householdId, period });
      const records = snapshotRecordsFromResult(result, householdId);
      await upsertSnapshots(supabase, records);
      snapshots += records.length;
    }
  } catch (e) {
    console.error("budget snapshot failed", e);
    errors.push({ scope: "budget_snapshot", error: e instanceof Error ? e.message : String(e) });
  }

  return NextResponse.json({
    posted: postedCount,
    pending: pendingCount,
    deleted: deletedCount,
    categorised: categorisedCount,
    dedupResolved: dedupAuto,
    dedupFlagged,
    transfersTagged,
    accountsPolled: txnCapable.length,
    windowDays,
    snapshots,
    errors,
  });
}
