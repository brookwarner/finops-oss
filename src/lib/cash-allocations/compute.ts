import { LIQUID_ACCOUNT_TYPES, isCurrentAccount } from "@/lib/accounts/classify";
import type { CashAllocationConfig } from "./contract";

export interface CashAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance_current: number | null;
  akahu_account_id: string | null;
  akahu_status: string | null;
  is_reserve_buffer: boolean;
  is_emergency_fund: boolean;
  refreshed_balance_at: string | null;
}

export interface CashAccountState {
  accountId: string;
  name: string;
  balance: number;
  protected: number;
  unallocated: number;
  shortfall: number;
  existingProtection: string | null;
  balanceUpdatedAt: string | null;
  unavailableReason: string | null;
  config: CashAllocationConfig;
}

export interface CashAvailability {
  accounts: CashAccountState[];
  business: { configured: boolean; cash: number; protected: number; availableToDraw: number | null; shortfall: number };
  totalProtected: number;
  issues: string[];
}

const cents = (n: number) => Math.round(n * 100);
export function eligibleCashAccount(a: CashAccount): boolean {
  return LIQUID_ACCOUNT_TYPES.has(a.type) && a.currency === "NZD" && isCurrentAccount(a);
}

/** Fixed allocations remain obligations even when cash is insufficient. Whole
 * accounts protect their positive balance. Existing reserve/emergency flags
 * take precedence: the same dollars are never deducted twice. */
export function computeCashAvailability(accounts: CashAccount[], configs: CashAllocationConfig[]): CashAvailability {
  const byId = new Map(configs.map((c) => [c.accountId, c]));
  const issues: string[] = [];
  const states = accounts.filter((a) => eligibleCashAccount(a) || byId.has(a.id)).map((a): CashAccountState => {
    const config = byId.get(a.id) ?? { accountId: a.id, revision: null, businessCash: false, wholeAccountLabel: null, pots: [] };
    const unavailableReason = !eligibleCashAccount(a) ? "Account is inactive or no longer NZD cash"
      : a.balance_current === null || !Number.isFinite(Number(a.balance_current)) ? "Balance unavailable; refresh bank accounts" : null;
    const balance = unavailableReason ? 0 : cents(Number(a.balance_current));
    if (unavailableReason && (config.businessCash || config.wholeAccountLabel || config.pots.length || a.is_reserve_buffer || a.is_emergency_fund)) {
      issues.push(`${a.name}: ${unavailableReason}. Clear the saved plan or restore the account before relying on cash availability.`);
    }
    const existingProtection = a.is_reserve_buffer ? "Household reserves" : a.is_emergency_fund ? "Emergency fund" : null;
    const protectedCents = existingProtection || config.wholeAccountLabel
      ? Math.max(0, balance)
      : config.pots.reduce((s, p) => s + cents(p.amount), 0);
    return {
      accountId: a.id, name: a.name, balance: balance / 100,
      protected: protectedCents / 100, unallocated: (balance - protectedCents) / 100,
      shortfall: Math.max(0, protectedCents - balance) / 100,
      existingProtection, balanceUpdatedAt: a.refreshed_balance_at, unavailableReason, config,
    };
  });
  // Do not silently ignore a saved obligation after an account changes currency
  // or type. The user needs to reconcile it before relying on availability.
  for (const c of configs) {
    if ((c.businessCash || c.wholeAccountLabel || c.pots.length) && !states.some((a) => a.accountId === c.accountId)) {
      issues.push("A saved allocation references a missing account; reconcile it before relying on cash availability");
    }
  }
  const business = states.filter((a) => a.config.businessCash);
  const sum = (rows: CashAccountState[], key: "balance" | "protected" | "unallocated") =>
    rows.reduce((s, a) => s + cents(a[key]), 0) / 100;
  const net = sum(business, "unallocated");
  return {
    accounts: states,
    business: { configured: business.length > 0, cash: sum(business, "balance"), protected: sum(business, "protected"),
      availableToDraw: issues.length ? null : Math.max(0, net), shortfall: Math.max(0, -net) },
    totalProtected: sum(states, "protected"),
    issues,
  };
}

/** Deduct only protection in the accounts included in this particular view.
 * Forecast everyday accounts, liquid cashflow and FI each have different pools. */
export function protectionInAccounts(state: CashAvailability, ids: Set<string>): number {
  assertCashAvailability(state);
  return state.accounts.filter((a) => ids.has(a.accountId)).reduce((s, a) => s + cents(a.protected), 0) / 100;
}

export function assertCashAvailability(state: CashAvailability): void {
  if (state.issues.length) throw new Error(state.issues.join(" "));
}
