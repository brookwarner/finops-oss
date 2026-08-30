import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { scopedDb } from "@/lib/supabase/scoped";
import { INBOX_CUTOFF } from "@/lib/constants";
import { categoryOptionsQuery } from "@/lib/categories/query";
import { getFirstNested } from "@/lib/supabase/relations";
import { TransactionsTable, type Cat, type Txn } from "../transactions/transactions-table";
import { SuggestionsReview, type Suggestion } from "./suggestions-review";

export const dynamic = "force-dynamic";

// The Inbox: transactions that the auto-categoriser couldn't place AND that
// the user hasn't explicitly chosen to leave uncategorised (is_manual_category
// = false). Reuses the TransactionsTable so bulk-categorise works for free.
export default async function InboxPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const db = scopedDb(supabase, householdId);

  const [txnsRes, catsRes, sugRes] = await Promise.all([
    db.transactions
      .select(
        "id, occurred_at, amount, merchant, description, merchant_logo_url, category_id, is_manual_category, accounts(name, type)",
      )
      .is("category_id", null)
      .eq("is_manual_category", false)
      .gte("occurred_at", INBOX_CUTOFF)
      .order("occurred_at", { ascending: false })
      .limit(500),
    categoryOptionsQuery(db),
    db.transactions
      .select("id, amount, merchant, description, category_id, accounts(type)")
      .eq("needs_review", true)
      .order("occurred_at", { ascending: false })
      .limit(500),
  ]);

  if (txnsRes.error) return <p className="text-sm text-negative">Error: {txnsRes.error.message}</p>;
  if (catsRes.error) return <p className="text-sm text-negative">Error: {catsRes.error.message}</p>;
  if (sugRes.error) return <p className="text-sm text-negative">Error: {sugRes.error.message}</p>;

  const txns: Txn[] = (txnsRes.data ?? []).map((row: any) => {
    const acct = getFirstNested<any>(row.accounts);
    return {
      id: row.id,
      occurred_at: row.occurred_at,
      amount: Number(row.amount),
      merchant: row.merchant,
      description: row.description,
      category_id: row.category_id,
      is_manual_category: row.is_manual_category,
      merchant_logo_url: row.merchant_logo_url,
      account: acct ? { name: acct.name ?? null, type: acct.type ?? null } : null,
    };
  });

  const categories: Cat[] = (catsRes.data ?? []) as Cat[];

  const suggestions: Suggestion[] = (sugRes.data ?? []).map((row: any) => {
    const acct = getFirstNested<any>(row.accounts);
    return {
      id: row.id,
      merchant: row.merchant,
      description: row.description,
      amount: Number(row.amount),
      category_id: row.category_id,
      account_type: acct?.type ?? null,
    };
  });

  return (
    <section>
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Inbox</h1>
      <p className="mb-5 text-sm text-ink-muted">
        {txns.length} transaction{txns.length === 1 ? "" : "s"} awaiting a category.
      </p>
      <SuggestionsReview initial={suggestions} categories={categories} />
      {txns.length === 0 ? (
        <p className="text-sm text-ink-muted">All caught up.</p>
      ) : (
        <TransactionsTable
          initialTxns={txns}
          categories={categories}
          showFilters={false}
          inbox
        />
      )}
    </section>
  );
}
