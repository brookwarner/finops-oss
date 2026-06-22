import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { scopedDb } from "@/lib/supabase/scoped";
import { uniqueHouseholdIds } from "@/lib/accounts/households";
import { getFirstNested } from "@/lib/supabase/relations";
import { buildAkahuClientFromEnv } from "@/lib/akahu/client";
import { getAkahuUserToken } from "@/lib/akahu/config";
import {
  buildAnthropicClient,
  getLLMSuggestions,
  resolveLLMSuggestions,
  type LlmCategory,
  type LlmTxn,
} from "@/lib/categorise/llm";
import { deriveLearnedRule } from "@/lib/categorise/learn";
import { computeNetWorth } from "@/lib/networth/compute";
import { buildNetWorthSnapshot } from "@/lib/networth/snapshot";
import { parsePortfolio, type PortfolioSource } from "@/lib/holdings/parse";
import { syncSubscriptions } from "@/lib/subscriptions/sync";
import { recomputeAmortisingLiabilities } from "@/lib/assets/recompute";

const LLM_BATCH_CAP = 100;
// LLM-cached rules sit above curated (50) and bootstrap (60-100 lower end) but
// below user-refined manual rules (40). See engine.ts priority scheme.
const LLM_RULE_PRIORITY = 70;

/**
 * The nightly refresh (balances, holdings, net-worth snapshot, subscriptions,
 * LLM categorisation fallback). Lives in lib (not the route module) so both the
 * `/api/cron/nightly` GET handler and the user-facing manual-sync route
 * (`/api/sync`) can call it — Next.js forbids non-HTTP exports from a route file.
 */
export async function runNightly(): Promise<NextResponse> {
  const supabase = createSupabaseServiceClient();
  const akahu = buildAkahuClientFromEnv();
  const token = await getAkahuUserToken();

  const fresh = await akahu.accounts.list(token);
  const byAkahuId = new Map(fresh.map((f) => [f._id, f]));

  // scoped-db-exempt: nightly cron intentionally ENUMERATES every household's
  // accounts (no household filter) to refresh balances/holdings, then scopes
  // per-household below (computeNetWorth/syncSubscriptions take a householdId).
  const { data: ours, error } = await supabase
    .from("accounts")
    .select("id, akahu_account_id, household_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ours) return NextResponse.json({ refreshed: 0 });

  let refreshed = 0;
  const now = new Date().toISOString();
  for (const a of ours) {
    const f = byAkahuId.get(a.akahu_account_id);
    if (!f) continue;
    // scoped-db-exempt: by-PK account update during the all-household enumeration above.
    await supabase
      .from("accounts")
      .update({
        akahu_status: f.status,
        attributes: f.attributes,
        balance_current: f.balance?.current ?? null,
        balance_available: f.balance?.available ?? null,
        refreshed_balance_at: f.refreshed?.balance ?? now,
        refreshed_meta_at: f.refreshed?.meta ?? null,
        refreshed_transactions_at: f.refreshed?.transactions ?? null,
        refreshed_party_at: f.refreshed?.party ?? null,
      })
      .eq("id", a.id);
    refreshed++;
  }

  // --- M5: holdings ingest (reuses meta.portfolio already on `fresh`) ---
  const runTs = new Date().toISOString();
  let holdings = 0;
  try {
    for (const a of ours) {
      const f = byAkahuId.get(a.akahu_account_id);
      if (!f) continue;
      const rows = parsePortfolio(f as unknown as PortfolioSource, {
        accountId: a.id,
        householdId: a.household_id,
      }).map((r) => ({ ...r, updated_at: runTs }));
      if (rows.length > 0) {
        // scoped-db-exempt: holdings rows carry household_id from parsePortfolio and
        // are upserted per-account inside the all-household enumeration above.
        const { error: upErr } = await supabase
          .from("holdings")
          .upsert(rows, { onConflict: "account_id,fund_id" });
        if (upErr) {
          // Skip the prune below so a failed refresh doesn't drop still-held rows.
          console.error("[nightly] holdings upsert failed", upErr.message, a.id);
          continue;
        }
        holdings += rows.length;
      }
      // Prune funds no longer held (and clear accounts with now-empty portfolios).
      // scoped-db-exempt: by-account-PK holdings prune within the all-household enumeration.
      const { error: delErr } = await supabase
        .from("holdings")
        .delete()
        .eq("account_id", a.id)
        .lt("updated_at", runTs);
      if (delErr) console.error("[nightly] holdings prune failed", delErr.message, a.id);
    }
  } catch (e) {
    console.error("[nightly] holdings ingest error", e);
  }

  // --- Amortising liabilities: reduce by real repayments before snapshotting ---
  let liabilities = 0;
  try {
    const householdIds = uniqueHouseholdIds(ours);
    for (const hid of householdIds) {
      liabilities += await recomputeAmortisingLiabilities({ supabase, householdId: hid });
    }
  } catch (e) {
    console.error("[nightly] amortising liabilities error", e);
  }

  // --- M5: daily net-worth snapshot per household ---
  let snapshot = false;
  try {
    const householdIds = uniqueHouseholdIds(ours);
    for (const hid of householdIds) {
      const nw = await computeNetWorth({ supabase, householdId: hid });
      const snap = buildNetWorthSnapshot(nw, {
        householdId: hid,
        snapshotDate: runTs.slice(0, 10),
      });
      const { error: snapErr } = await scopedDb(supabase, hid)
        .net_worth_snapshots.upsert(snap, { onConflict: "household_id,snapshot_date" });
      if (snapErr) console.error("[nightly] snapshot upsert failed", snapErr.message, hid);
      else snapshot = true;
    }
  } catch (e) {
    console.error("[nightly] snapshot error", e);
  }

  // --- F2: subscription detection per household ---
  let subscriptions = 0;
  try {
    const householdIds = uniqueHouseholdIds(ours);
    for (const hid of householdIds) {
      const res = await syncSubscriptions(supabase, hid);
      subscriptions += res.count;
    }
  } catch (e) {
    console.error("[nightly] subscriptions sync error", e);
  }

  // ---- LLM categorisation fallback (nightly only) ----
  // Wrapped so a slow/timed-out Anthropic call degrades to "0 suggested" instead
  // of aborting the whole run — balances/holdings/snapshots above are already
  // committed, and the manual "Sync now" button must not 500 on this optional step.
  const client = buildAnthropicClient();
  let suggested = 0;
  let remaining = 0;
  try {
  if (client) {
    // scoped-db-exempt: nightly LLM fallback enumerates uncategorised txns across
    // ALL households in one batch; each row carries household_id and the learned
    // rule is written per-row's household below. Categories are loaded globally to
    // match by name regardless of household.
    const { data: catRows, error: catErr } = await supabase
      .from("categories")
      .select("id, name, group, kind");
    if (catErr) console.error("[nightly] categories load failed", catErr.message);
    const categories = (catRows ?? []) as LlmCategory[];

    // scoped-db-exempt: cross-household enumeration of the uncategorised inbox (see above).
    const { data: uncat, error: uncatErr } = await supabase
      .from("transactions")
      .select("id, household_id, merchant, description, amount, accounts(type)")
      .is("category_id", null)
      .eq("is_manual_category", false)
      .limit(LLM_BATCH_CAP + 1);
    if (uncatErr) console.error("[nightly] uncategorised fetch failed", uncatErr.message);

    const rows = categories.length === 0 ? [] : uncat ?? [];
    remaining = Math.max(0, rows.length - LLM_BATCH_CAP);
    const batch = rows.slice(0, LLM_BATCH_CAP);

    const llmTxns: LlmTxn[] = batch.map((r) => {
      const acct = getFirstNested(r.accounts);
      return {
        id: r.id,
        merchant: r.merchant,
        description: r.description,
        amount: Number(r.amount),
        account_type: acct?.type ?? null,
      };
    });
    const householdById = new Map(batch.map((r) => [r.id, r.household_id]));
    const merchantById = new Map(batch.map((r) => [r.id, r.merchant]));
    const descriptionById = new Map(batch.map((r) => [r.id, r.description]));

    const raw = await getLLMSuggestions(llmTxns, categories, client);
    const resolutions = resolveLLMSuggestions(raw, categories);

    for (const res of resolutions) {
      // scoped-db-exempt: by-PK transaction update keyed on the globally-unique id
      // resolved from the cross-household batch above.
      const { error: upErr } = await supabase
        .from("transactions")
        .update({ category_id: res.category_id, needs_review: true })
        .eq("id", res.id)
        .is("category_id", null)
        .eq("is_manual_category", false);
      if (upErr) continue;

      const merchant = merchantById.get(res.id) ?? null;
      const householdId = householdById.get(res.id);
      // Learn a reusable rule from the LLM's call. Bank transfers carry no
      // merchant, so fall back to a description-stem pattern (deriveLearnedRule
      // guards against minting a rule from a generic transfer-mechanism row) —
      // without this, merchant-null rows were re-suggested every single night.
      const learned = householdId ? deriveLearnedRule(merchant, descriptionById.get(res.id) ?? null) : null;
      if (householdId && learned) {
        const { error: ruleErr } = await scopedDb(supabase, householdId).category_rules.upsert(
          {
            category_id: res.category_id,
            match_type: learned.match_type,
            match_value: learned.match_value,
            field: learned.field,
            priority: LLM_RULE_PRIORITY,
            source: "llm",
            confidence: res.confidence,
          },
          { onConflict: "household_id,match_type,match_value,field,min_amount,max_amount" },
        );
        if (ruleErr) console.error("[nightly] rule upsert failed", ruleErr.message, res.id);
      }
      suggested++;
    }
  }
  } catch (e) {
    console.error("[nightly] LLM categorisation fallback error", e);
  }

  return NextResponse.json({ refreshed, holdings, liabilities, snapshot, subscriptions, suggested, remaining });
}
