import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { scopedDb } from "@/lib/supabase/scoped";
import { categoryOptionsQuery } from "@/lib/categories/query";
import { getFirstNested } from "@/lib/supabase/relations";
import { categorisePending, type Rule } from "@/lib/categorise/engine";
import { TransactionsTable, type Acct, type Cat, type PendingTxn, type Txn } from "./transactions-table";

export const dynamic = "force-dynamic";

type SP = {
  category?: string;
  q?: string;
  from?: string;
  to?: string;
  uncategorised?: string;
  account?: string;
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const db = scopedDb(supabase, householdId);

  let query = db.transactions
    .select(
      "id, occurred_at, amount, merchant, description, merchant_logo_url, category_id, is_manual_category, accounts(name, type)",
    )
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (sp.category) query = query.eq("category_id", sp.category);
  if (sp.account) query = query.eq("account_id", sp.account);
  if (sp.uncategorised === "1") {
    query = query.is("category_id", null).eq("is_manual_category", false);
  }
  if (sp.q) {
    const term = `%${sp.q}%`;
    query = query.or(`merchant.ilike.${term},description.ilike.${term}`);
  }
  if (sp.from) query = query.gte("occurred_at", sp.from);
  if (sp.to) query = query.lt("occurred_at", sp.to);

  // Pending (unsettled) rows sit in a separate table, are read-only, and carry
  // no category column — but the merchant is the description prefix, so the same
  // rules engine the budget overlay uses (`categorisePending`) resolves most of
  // them to a category. Show them in the main Transactions view (not the Inbox —
  // they aren't actionable). When a category filter is active we keep only the
  // pending rows that resolve to that category, so the list matches the "+X
  // pending" the budget attributed. Account / search / date filters still apply.
  const showPending = sp.uncategorised !== "1";
  let pendingQuery = showPending
    ? db.pending_transactions
        .select("id, occurred_at, amount, description, accounts(name, type)")
        .order("occurred_at", { ascending: false })
        .limit(200)
    : null;
  if (pendingQuery) {
    if (sp.account) pendingQuery = pendingQuery.eq("account_id", sp.account);
    if (sp.q) pendingQuery = pendingQuery.ilike("description", `%${sp.q}%`);
    if (sp.from) pendingQuery = pendingQuery.gte("occurred_at", sp.from);
    if (sp.to) pendingQuery = pendingQuery.lt("occurred_at", sp.to);
  }
  // Rules are only needed to attribute pending → category when a category filter
  // is active; otherwise skip the query entirely.
  const rulesQuery =
    showPending && sp.category
      ? db.category_rules.select(
          "id, category_id, match_type, match_value, field, priority, source, min_amount, max_amount",
        )
      : null;

  const [txnsRes, catsRes, acctsRes, pendingRes, rulesRes] = await Promise.all([
    query,
    categoryOptionsQuery(db),
    db.accounts.select("id, name").order("name"),
    pendingQuery ?? Promise.resolve({ data: [], error: null }),
    rulesQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  if (txnsRes.error) return <p className="text-sm text-negative">Error: {txnsRes.error.message}</p>;
  if (catsRes.error) return <p className="text-sm text-negative">Error: {catsRes.error.message}</p>;
  if (acctsRes.error) return <p className="text-sm text-negative">Error: {acctsRes.error.message}</p>;

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

  // When a category filter is active, keep only the pending rows the rules
  // engine resolves to that category — mirroring how the budget overlay
  // attributes pending spend. Without a category filter, show them all.
  const rules = (rulesRes.error ? [] : ((rulesRes.data ?? []) as Rule[]));
  const pendingRows = ((pendingRes.data ?? []) as any[]).filter((row) =>
    sp.category
      ? categorisePending(
          { description: row.description ?? null, amount: Number(row.amount) },
          rules,
        ) === sp.category
      : true,
  );
  const pendingTxns: PendingTxn[] = pendingRows.map((row: any) => {
    const acct = getFirstNested<any>(row.accounts);
    return {
      id: row.id,
      occurred_at: row.occurred_at,
      amount: Number(row.amount),
      description: row.description,
      account: acct ? { name: acct.name ?? null, type: acct.type ?? null } : null,
    };
  });

  const categories: Cat[] = (catsRes.data ?? []) as Cat[];
  const accounts: Acct[] = (acctsRes.data ?? []) as Acct[];

  return (
    <section>
      <h1 className="mb-5 text-[26px] font-bold tracking-tight">
        {sp.uncategorised === "1" ? "Inbox" : "Transactions"}
      </h1>
      {txns.length === 0 && pendingTxns.length === 0 && !sp.category && !sp.q && !sp.uncategorised && !sp.account ? (
        <p className="text-sm text-ink-muted">No transactions yet. Run a backfill.</p>
      ) : (
        <TransactionsTable
          // Remount when any filter changes so the client adopts the freshly
          // queried rows. Without this, `useState(initialTxns)` keeps the
          // original list on subsequent server renders and search/filter
          // appear to do nothing.
          key={`${sp.category ?? ""}|${sp.q ?? ""}|${sp.uncategorised ?? ""}|${sp.from ?? ""}|${sp.to ?? ""}|${sp.account ?? ""}`}
          initialTxns={txns}
          pendingTxns={pendingTxns}
          categories={categories}
          accounts={accounts}
          activeCategory={sp.category ?? ""}
          activeQuery={sp.q ?? ""}
          activeAccount={sp.account ?? ""}
          activeFrom={sp.from ?? ""}
          activeTo={sp.to ?? ""}
          showFilters={sp.uncategorised !== "1"}
        />
      )}
    </section>
  );
}
