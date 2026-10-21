// Pure reserve-withdrawal detection. A reserve (sinking-fund) drawdown is any
// outflow transaction categorised to a reserve-kind category. Accruals are not
// transactions (the nightly cron just bumps reserve_balance), so every real txn
// in a reserve category is a genuine spend or refund — we only ping on the
// outflow (drawdown), never the refund. Dedup keys on the transaction id.

export interface ReserveTxn {
  id: string;
  categoryId: string;
  category: string;
  amount: number; // Akahu sign convention: debits/outflows negative
  occurredAt: string;
  merchant: string | null;
  reserveBalance: number | null; // remaining balance for the fund, if known
}

export interface ReserveEvent {
  type: "reserve_withdrawal";
  txnId: string;
  categoryId: string;
  category: string;
  amount: number; // positive drawdown magnitude
  reserveBalance: number | null;
  occurredAt: string;
  merchant: string | null;
}

export function decideReserveWithdrawals(
  txns: ReserveTxn[],
  alreadyAlertedTxnIds: Set<string>,
): ReserveEvent[] {
  const events: ReserveEvent[] = [];
  for (const t of txns) {
    if (t.amount >= 0) continue; // only outflows (drawdowns)
    if (alreadyAlertedTxnIds.has(t.id)) continue;
    events.push({
      type: "reserve_withdrawal",
      txnId: t.id,
      categoryId: t.categoryId,
      category: t.category,
      amount: Math.abs(t.amount),
      reserveBalance: t.reserveBalance,
      occurredAt: t.occurredAt,
      merchant: t.merchant,
    });
  }
  return events;
}
