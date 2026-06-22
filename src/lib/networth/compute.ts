import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { getFirstNested } from "@/lib/supabase/relations";

export interface NetWorthAccount { name: string; type: string; balance: number; isLiability: boolean; }
export interface NetWorthResult { assets: number; liabilities: number; net: number; accounts: NetWorthAccount[]; }

// Akahu stores balances signed: assets positive, liabilities (loans, mortgages,
// credit cards, overdrawn accounts) negative. We classify the assets/liabilities
// split by SIGN rather than account type — robust to mislabelled accounts (e.g. a
// loan recorded with a "checking" type still has a negative balance and counts as
// a liability). `liabilities` is reported as a negative total so money owed reads
// as a negative; net worth is the plain signed sum (assets + liabilities), NOT a
// subtraction — that would double-negate and inflate net worth.
// Includes manual assets stored in `accounts` (e.g. the home, keyed by a synthetic
// akahu_account_id), so `net` now spans bank/loan balances and manual valuations.
export async function computeNetWorth(args: { supabase: SupabaseClient; householdId: string }): Promise<NetWorthResult> {
  const { data, error } = await scopedDb(args.supabase, args.householdId)
    .accounts.select("name, type, balance_current, expected_inflows(likelihood)");
  if (error) throw new Error(error.message);
  let assets = 0, liabilities = 0;
  const accounts: NetWorthAccount[] = [];
  for (const a of (data ?? []) as any[]) {
    const likelihood = getFirstNested<{ likelihood?: string }>(a.expected_inflows)?.likelihood;
    if (a.type === "receivable" && likelihood === "uncertain") continue; // uncertain money you're owed doesn't pad net worth
    const balance = Number(a.balance_current ?? 0);
    const isLiability = balance < 0;
    if (isLiability) liabilities += balance; else assets += balance;
    accounts.push({ name: a.name, type: a.type, balance, isLiability });
  }
  return { assets, liabilities, net: assets + liabilities, accounts };
}
