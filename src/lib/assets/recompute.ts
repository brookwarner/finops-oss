import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { projectBalance } from "./amortise";

/** Recompute every amortising liability for a household from its linked
 * category's repayments and persist accounts.balance_current = -balance.
 * Returns the number of liabilities updated. Never throws on a single bad row —
 * logs and continues so the nightly cron stays resilient. */
export async function recomputeAmortisingLiabilities(args: {
  supabase: SupabaseClient;
  householdId: string;
}): Promise<number> {
  const db = scopedDb(args.supabase, args.householdId);
  const { data: liabilities, error } = await db.amortising_liabilities.select(
    "akahu_account_id, anchor_balance, anchor_date, annual_rate, repayment_category_id",
  );
  if (error) throw new Error(error.message);

  let updated = 0;
  for (const L of (liabilities ?? []) as any[]) {
    try {
      const { data: txns, error: tErr } = await db.transactions
        .select("amount, occurred_at")
        .eq("category_id", L.repayment_category_id)
        .gte("occurred_at", L.anchor_date)
        .order("occurred_at", { ascending: true });
      if (tErr) throw new Error(tErr.message);

      const { balance } = projectBalance({
        anchorBalance: Number(L.anchor_balance),
        annualRate: Number(L.annual_rate),
        anchorDate: String(L.anchor_date).slice(0, 10),
        payments: (txns ?? []).map((t: any) => ({
          amount: Number(t.amount),
          date: String(t.occurred_at).slice(0, 10),
        })),
      });

      const { error: uErr } = await db.accounts
        .update({ balance_current: -balance, refreshed_balance_at: new Date().toISOString() })
        .eq("akahu_account_id", L.akahu_account_id);
      if (uErr) throw new Error(uErr.message);
      updated++;
    } catch (e) {
      console.error("[recompute] amortising liability failed", L.akahu_account_id, e);
    }
  }
  return updated;
}
