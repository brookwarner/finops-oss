// src/lib/buffer/compute.ts
//
// Emergency fund (cash buffer): a sized, tracked stock of liquid cash held for
// income shocks / surprises — distinct from sinking-fund reserves (earmarked for
// known costs), the savings contribution goal (a flow), and FI investments
// (long-term, market-exposed).
//
// Sizing is AUTO: target = N months × your average monthly spend, so it
// self-adjusts as costs change. The base is your *whole* spend — every spendable
// category (monthly_cap + ap_amortised), discretionary as well as essential —
// not a bare-survival floor: a real income shock has you paying for life roughly
// as you actually live it, not an idealised minimum. (Sinking-fund reserves and
// savings/investment contributions are excluded — they're future-cost accruals
// you'd pause, not consumption.) Spend is measured the same way the budget page
// measures it — see monthlySpendRate — so an `ap_amortised` must-pay like the
// mortgage counts its full cash-out leg (not netted to ~$0 by the transfer's far
// leg). The balance is a DESIGNATED liquid account (accounts.is_emergency_fund),
// carved out of FI assets — the same dollars aren't both safety net and FI
// progress.

import type { SupabaseClient } from "@supabase/supabase-js";
import { scopedDb } from "@/lib/supabase/scoped";
import { COMMITTED_EXCLUDED_NAMES } from "@/lib/budgets/committed";

export interface EmergencyFundState {
  /** Whether an account is designated as the emergency fund. */
  configured: boolean;
  accountName: string | null;
  balance: number;          // designated account balance (≥ 0)
  monthlySpend: number;     // trailing average total spend, per month
  targetMonths: number;     // N (months of spend)
  target: number;           // targetMonths × monthlySpend
  shortfall: number;        // max(0, target − balance) — what's still to fund
  monthsCovered: number | null; // balance ÷ monthlySpend
  pctFunded: number | null; // balance ÷ target
  funded: boolean;          // balance ≥ target (target > 0)
}

const DEFAULT_TARGET_MONTHS = 4;

/** Pure: derive the fund state from its inputs. */
export function emergencyFundState(args: {
  configured: boolean;
  accountName: string | null;
  balance: number;
  monthlySpend: number;
  targetMonths: number;
}): EmergencyFundState {
  const balance = Math.max(0, args.balance);
  const monthlySpend = Math.max(0, args.monthlySpend);
  const targetMonths = Math.max(0, args.targetMonths);
  const target = monthlySpend * targetMonths;
  return {
    configured: args.configured,
    accountName: args.accountName,
    balance,
    monthlySpend,
    targetMonths,
    target,
    shortfall: Math.max(0, target - balance),
    monthsCovered: monthlySpend > 0 ? balance / monthlySpend : null,
    pctFunded: target > 0 ? balance / target : null,
    funded: target > 0 && balance >= target,
  };
}

/** Pure: trailing spend scaled to a month. Mirrors the budget engine's per-kind
 *  spend (see `effectiveSpend`, budgets/compute.ts): `ap_amortised` (auto-pay)
 *  categories count the gross outflow leg only — a mortgage/loan repayment is a
 *  two-legged transfer whose far leg lands as an inflow, and netting it would
 *  cancel each repayment to ~$0, sizing the fund far too small (it would omit the
 *  must-pay mortgage entirely). Other kinds net refunds (inflows) against spend. */
export function monthlySpendRate(txns: { amount: number; kind?: string }[], windowDays: number): number {
  if (windowDays <= 0) return 0;
  let spend = 0;
  for (const t of txns) {
    const outflow = -Number(t.amount); // outflow positive, inflow negative
    spend += t.kind === "ap_amortised" ? Math.max(0, outflow) : outflow;
  }
  return (Math.max(0, spend) * 365) / (windowDays * 12);
}

const DAY_MS = 86_400_000;
const SPEND_WINDOW_DAYS = 365;
const SPENDABLE_KINDS = new Set(["monthly_cap", "ap_amortised"]);

/**
 * Load the emergency-fund state from live data. Monthly spend comes from the
 * trailing year of spend across every spendable category (monthly_cap +
 * ap_amortised); the balance/target from the designated `is_emergency_fund`
 * account. Returns `configured: false` (with the would-be target) when none is
 * designated, so callers can prompt setup without erroring.
 */
export async function computeEmergencyFund(args: {
  supabase: SupabaseClient;
  householdId: string;
  now?: Date;
}): Promise<EmergencyFundState> {
  const { supabase, householdId } = args;
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - SPEND_WINDOW_DAYS * DAY_MS).toISOString();
  const db = scopedDb(supabase, householdId);

  // A trailing-year transaction scan exceeds PostgREST's 1000-row page cap, so it
  // MUST page (a plain .select() silently truncates to the most recent 1000 rows,
  // dropping a big chunk of spend — e.g. the mortgage — and sizing the fund far
  // too small). Mirrors the budget engine's paged scan.
  const [acctRes, spendRows] = await Promise.all([
    db.accounts
      .select("name, balance_current, emergency_fund_target_months")
      .eq("is_emergency_fund", true)
      .maybeSingle(),
    db.transactions.selectAllPaged<any>((q) =>
      q.select("amount, categories(kind, name)")
        .gte("occurred_at", since)
        .not("category_id", "is", null)
        .order("occurred_at", { ascending: false }),
    ),
  ]);
  if (acctRes.error) throw new Error(acctRes.error.message);

  const spendTxns = (spendRows as any[]).reduce<{ amount: number; kind: string }[]>((acc, t) => {
    const c = Array.isArray(t.categories) ? t.categories[0] : t.categories;
    // Exclude the silent "Mortgage Interest" charge: it keeps kind=ap_amortised
    // but its cost is already inside the gross Mortgage Part repayment (counted
    // above), so counting it again double-counts ~$2.7k/mo. Mirrors how the budget
    // engine drops it (position.ts / committed.ts COMMITTED_EXCLUDED_NAMES).
    if (c && SPENDABLE_KINDS.has(c.kind) && !COMMITTED_EXCLUDED_NAMES.has(c.name)) {
      acc.push({ amount: Number(t.amount), kind: c.kind as string });
    }
    return acc;
  }, []);
  const monthlySpend = monthlySpendRate(spendTxns, SPEND_WINDOW_DAYS);

  const acct = acctRes.data as { name: string; balance_current: number | null; emergency_fund_target_months: number | null } | null;
  return emergencyFundState({
    configured: !!acct,
    accountName: acct?.name ?? null,
    balance: Number(acct?.balance_current ?? 0),
    monthlySpend,
    targetMonths: acct ? Number(acct.emergency_fund_target_months ?? DEFAULT_TARGET_MONTHS) : DEFAULT_TARGET_MONTHS,
  });
}
