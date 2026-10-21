import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";

export interface TxnRow {
  id: string; occurred_at: string; amount: number;
  merchant: string | null; description: string | null; category: string | null;
}
const SELECT = "id, occurred_at, amount, merchant, description, categories(name)";

function shape(rows: any[]): TxnRow[] {
  return (rows ?? []).map((t) => ({
    id: t.id, occurred_at: t.occurred_at, amount: Number(t.amount),
    merchant: t.merchant ?? null, description: t.description ?? null,
    category: getFirstNested(t.categories)?.name ?? null,
  }));
}

export async function recentTransactions(args: {
  supabase: SupabaseClient; householdId: string; limit?: number; since?: string; categoryName?: string;
}): Promise<TxnRow[]> {
  let q = scopedDb(args.supabase, args.householdId).transactions.select(SELECT);
  if (args.since) q = q.gte("occurred_at", args.since);
  const { data, error } = await q.order("occurred_at", { ascending: false }).limit(args.limit ?? 20);
  if (error) throw new Error(error.message);
  let rows = shape(data as any[]);
  if (args.categoryName) rows = rows.filter((r) => r.category?.toLowerCase() === args.categoryName!.toLowerCase());
  return rows;
}

export async function searchTransactions(args: {
  supabase: SupabaseClient; householdId: string; query: string; limit?: number;
}): Promise<TxnRow[]> {
  const safe = args.query.replace(/[%,()]/g, " ");
  const { data, error } = await scopedDb(args.supabase, args.householdId).transactions.select(SELECT)
    .or(`merchant.ilike.%${safe}%,description.ilike.%${safe}%`)
    .order("occurred_at", { ascending: false }).limit(args.limit ?? 20);
  if (error) throw new Error(error.message);
  return shape(data as any[]);
}
