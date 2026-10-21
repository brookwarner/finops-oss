import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { cashAllocationSchema, type CashAllocationConfig } from "./contract";
import { computeCashAvailability, eligibleCashAccount, type CashAccount } from "./compute";

export class CashAllocationConflict extends Error {}
export class InvalidCashAllocation extends Error {}

export const CASH_ACCOUNT_COLUMNS = "id, name, type, currency, balance_current, akahu_account_id, akahu_status, is_reserve_buffer, is_emergency_fund, refreshed_balance_at";

export async function loadCashAllocationConfigs(supabase: SupabaseClient, householdId: string): Promise<CashAllocationConfig[]> {
  const rows = await scopedDb(supabase, householdId).cash_allocations.selectAllPaged((q) => q.select("*"));
  return rows.map((r) => cashAllocationSchema.parse({ accountId: r.account_id, revision: r.revision,
    businessCash: r.business_cash, wholeAccountLabel: r.whole_account_label, pots: r.pots }));
}

export async function loadCashAvailability(supabase: SupabaseClient, householdId: string) {
  const [accounts, configs] = await Promise.all([
    scopedDb(supabase, householdId).accounts.selectAllPaged<CashAccount>((q) => q.select(CASH_ACCOUNT_COLUMNS)),
    loadCashAllocationConfigs(supabase, householdId),
  ]);
  return computeCashAvailability(accounts, configs);
}

/** Replace one account's allocation plan atomically. Revision must come from
 * the last read; stale edits return a conflict rather than overwriting money. */
export async function saveCashAllocation(supabase: SupabaseClient, householdId: string, input: CashAllocationConfig) {
  const config = cashAllocationSchema.parse(input);
  const db = scopedDb(supabase, householdId);
  const { data: account, error: readError } = await db.accounts.select(CASH_ACCOUNT_COLUMNS).eq("id", config.accountId).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!account) throw new InvalidCashAllocation("Account not found in your household");
  const clearing = !config.businessCash && !config.wholeAccountLabel && !config.pots.length;
  if (!clearing && !eligibleCashAccount(account)) throw new InvalidCashAllocation("Choose an active NZD checking, savings or wallet account");
  if (!clearing && account.balance_current === null) throw new InvalidCashAllocation("Refresh this account before allocating cash");
  if ((account.is_reserve_buffer || account.is_emergency_fund) && (config.wholeAccountLabel || config.pots.length)) {
    throw new InvalidCashAllocation("This account is already protected for reserves or emergencies");
  }
  const values = { business_cash: config.businessCash, whole_account_label: config.wholeAccountLabel,
    pots: config.pots, revision: (config.revision ?? 0) + 1 };
  const result = config.revision === null
    ? await db.cash_allocations.insert({ account_id: config.accountId, ...values }).select("account_id").single()
    : await db.cash_allocations.update(values).eq("account_id", config.accountId).eq("revision", config.revision).select("account_id").maybeSingle();
  if (result.error?.code === "23505" || (!result.error && !result.data)) {
    throw new CashAllocationConflict("Allocations changed elsewhere. Reload before saving again.");
  }
  if (result.error) throw new Error(result.error.message);
  return { ...config, revision: values.revision };
}
