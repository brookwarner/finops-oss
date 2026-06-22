import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveLearnedRule } from "@/lib/categorise/learn";
import { scopedDb } from "@/lib/supabase/scoped";
import { UUID_RE } from "@/lib/uuid";

/**
 * Upsert the rule learned from one manual categorisation and drop any stale
 * llm-sourced rule that pointed the same match at a different category. Shared by
 * the dropdown path (categoriseTransactions) and the inbox Accept path
 * (acceptSuggestions) so both teach the system identically. No-op when no safe
 * rule can be derived (e.g. a transfer-mechanism description).
 */
async function learnRule(
  db: ReturnType<typeof scopedDb>,
  categoryId: string,
  merchant: string | null,
  description: string | null,
): Promise<void> {
  const learned = deriveLearnedRule(merchant, description);
  if (!learned) return;

  const { error: upsertErr } = await db.category_rules.upsert(
    {
      category_id: categoryId,
      match_type: learned.match_type,
      match_value: learned.match_value,
      field: learned.field,
      priority: 40,
      source: "manual",
    },
    { onConflict: "household_id,match_type,match_value,field" },
  );
  if (upsertErr) console.error("[write] manual rule upsert failed", upsertErr.message);

  const { error: deleteErr } = await db.category_rules
    .delete()
    .eq("source", "llm")
    .eq("match_type", learned.match_type)
    .eq("field", learned.field)
    .eq("match_value", learned.match_value)
    .neq("category_id", categoryId);
  if (deleteErr) console.error("[write] stale llm rule delete failed", deleteErr.message);
}

export type CategoriseResult = {
  updated: number;
  similarCount: number;
  /** Merchant to pass to applySimilar when the learned rule is merchant-based; null for description rules or bulk/uncategorise. */
  similarMerchant?: string | null;
};

/**
 * Assign a category to one or many transactions. On a SINGLE transaction with a
 * real (UUID) category, learn a rule and report how many other uncategorised
 * transactions that rule would also match (the preview). Bulk + uncategorise skip
 * learning. Relocated from app/api/transactions/categorise/route.ts.
 */
export async function categoriseTransactions(args: {
  supabase: SupabaseClient;
  householdId: string;
  transactionIds: string[];
  categoryId: string | null;
}): Promise<CategoriseResult> {
  const { supabase, householdId, transactionIds, categoryId } = args;
  const db = scopedDb(supabase, householdId);

  const { error } = await db.transactions
    .update({
      category_id: categoryId,
      is_manual_category: categoryId !== null,
      needs_review: false,
    })
    .in("id", transactionIds);
  if (error) throw new Error(error.message);

  if (transactionIds.length !== 1 || categoryId === null || !UUID_RE.test(categoryId)) {
    return { updated: transactionIds.length, similarCount: 0 };
  }

  const txnId = transactionIds[0];
  const { data: txn, error: txnErr } = await db.transactions
    .select("merchant, description")
    .eq("id", txnId)
    .single();
  if (txnErr || !txn) return { updated: 1, similarCount: 0 };

  const learned = deriveLearnedRule(txn.merchant, txn.description);
  if (!learned) return { updated: 1, similarCount: 0 };

  await learnRule(db, categoryId, txn.merchant, txn.description);

  let similar = db.transactions
    .select("id", { count: "exact", head: true })
    .eq("is_manual_category", false)
    .or(`category_id.is.null,category_id.neq.${categoryId}`);
  similar =
    learned.field === "merchant"
      ? similar.eq("merchant", learned.match_value)
      : similar.ilike("description", `%${learned.match_value}%`);
  const { count } = await similar;

  return {
    updated: 1,
    similarCount: count ?? 0,
    similarMerchant: learned.field === "merchant" ? learned.match_value : null,
  };
}

/** Apply a category to every non-manual transaction for a merchant. */
export async function applySimilar(args: {
  supabase: SupabaseClient;
  householdId: string;
  merchant: string;
  categoryId: string;
}): Promise<{ updated: number }> {
  const { supabase, householdId, merchant, categoryId } = args;
  const { data, error } = await scopedDb(supabase, householdId).transactions
    .update({ category_id: categoryId, is_manual_category: true, needs_review: false })
    .eq("merchant", merchant)
    .eq("is_manual_category", false)
    .select("id");
  if (error) throw new Error(error.message);
  return { updated: data?.length ?? 0 };
}

/**
 * Accept pending suggestions: clear needs_review, and for any row that already
 * carries a category, mark it manual + learn a rule so the same wording is never
 * re-asked. Accepting is an explicit confirmation, so it teaches the system just
 * like the dropdown path. Rows with no category (a fuzzy flag with nothing
 * suggested) only get needs_review cleared — never marked manually-uncategorised.
 */
export async function acceptSuggestions(args: {
  supabase: SupabaseClient;
  householdId: string;
  transactionIds?: string[];
}): Promise<{ accepted: number }> {
  const { supabase, householdId, transactionIds } = args;
  const db = scopedDb(supabase, householdId);

  let sel = db.transactions
    .select("id, category_id, merchant, description")
    .eq("needs_review", true);
  if (transactionIds && transactionIds.length > 0) sel = sel.in("id", transactionIds);
  const { data: targets, error: selErr } = await sel;
  if (selErr) throw new Error(selErr.message);
  const rows = (targets ?? []) as {
    id: string;
    category_id: string | null;
    merchant: string | null;
    description: string | null;
  }[];
  if (rows.length === 0) return { accepted: 0 };

  const categorised = rows.filter((r) => r.category_id);
  const uncategorised = rows.filter((r) => !r.category_id);

  if (categorised.length > 0) {
    const { error } = await db.transactions
      .update({ needs_review: false, is_manual_category: true })
      .in("id", categorised.map((r) => r.id));
    if (error) throw new Error(error.message);
  }
  if (uncategorised.length > 0) {
    const { error } = await db.transactions
      .update({ needs_review: false })
      .in("id", uncategorised.map((r) => r.id));
    if (error) throw new Error(error.message);
  }

  for (const r of categorised) {
    await learnRule(db, r.category_id as string, r.merchant, r.description);
  }

  return { accepted: rows.length };
}
