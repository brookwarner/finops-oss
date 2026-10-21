import type { Transaction, PendingTransaction } from "akahu";
import type { Json } from "@/lib/supabase/database.types";

// Akahu's transaction shape is RawTransaction | EnrichedTransaction. Enriched
// adds merchant/category/meta. We accept both, hoisting fields where present.

export function isEnriched(t: Transaction): t is Extract<Transaction, { merchant: unknown }> {
  return "merchant" in t;
}

export function normalisePostedTx(t: Transaction, opts: {
  householdId: string;
  accountId: string;
}) {
  const enriched = isEnriched(t) ? t : null;
  return {
    household_id: opts.householdId,
    account_id: opts.accountId,
    akahu_transaction_id: t._id,
    occurred_at: t.date,
    amount: t.amount,
    akahu_type: t.type,
    description: t.description,
    merchant: enriched?.merchant?.name ?? null,
    akahu_merchant_id: enriched?.merchant?._id ?? null,
    merchant_logo_url: enriched?.meta?.logo ?? null,
    akahu_category_id: enriched?.category?._id ?? null,
    particulars: enriched?.meta?.particulars ?? null,
    code: enriched?.meta?.code ?? null,
    reference: enriched?.meta?.reference ?? null,
    other_account: enriched?.meta?.other_account ?? null,
    card_suffix: enriched?.meta?.card_suffix ?? null,
    conversion: enriched?.meta?.conversion ?? null,
    balance_after: t.balance ?? null,
    raw: t as unknown as Json,
    last_seen_at: new Date().toISOString(),
  };
}

export function normalisePendingTx(t: PendingTransaction, opts: {
  householdId: string;
  accountId: string;
}) {
  return {
    household_id: opts.householdId,
    account_id: opts.accountId,
    occurred_at: t.date,
    amount: t.amount,
    akahu_type: t.type,
    description: t.description,
    raw: t as unknown as Json,
  };
}

// Extract embedded category metadata for lazy-seeding akahu_categories.
// Returns the unique set of (id, name, groups) tuples encountered in the
// batch so the caller can upsert before inserting transactions that FK to them.
export function extractCategories(txs: Transaction[]) {
  const map = new Map<string, { id: string; name: string; groups: Json }>();
  for (const t of txs) {
    if (!isEnriched(t) || !t.category) continue;
    if (!map.has(t.category._id)) {
      map.set(t.category._id, {
        id: t.category._id,
        name: t.category.name,
        groups: t.category.groups,
      });
    }
  }
  return Array.from(map.values());
}
