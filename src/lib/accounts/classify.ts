// src/lib/accounts/classify.ts
// Neutral account-classification helpers shared across cashflow/forecast loaders.

// Account types whose balance is spendable cash (the liquid survival floor).
export const LIQUID_ACCOUNT_TYPES = new Set(["checking", "savings", "wallet"]);

interface RevolvingFlag {
  is_revolving_facility?: boolean | null;
}

/** A revolving/offset credit facility: its undrawn available balance is runway
 *  beyond cash. Flagged per-account via accounts.is_revolving_facility (0046). */
export function isRevolvingFacility(account: RevolvingFlag): boolean {
  return account.is_revolving_facility === true;
}

interface CreditAccount extends RevolvingFlag {
  type: string;
  balance_current: number | null;
  balance_available: number | null;
}

/** Total available credit headroom = each flagged revolving facility's undrawn
 *  available PLUS each everyday (liquid) account's overdraft headroom
 *  (available − current, positive only). */
export function creditHeadroom(accounts: CreditAccount[]): number {
  let total = 0;
  for (const a of accounts) {
    if (isRevolvingFacility(a)) {
      total += Math.max(0, Number(a.balance_available ?? 0));
    } else if (LIQUID_ACCOUNT_TYPES.has(a.type)) {
      const avail = Number(a.balance_available ?? 0);
      const cur = Number(a.balance_current ?? 0);
      total += Math.max(0, avail - cur);
    }
  }
  return Math.round(total * 100) / 100;
}
