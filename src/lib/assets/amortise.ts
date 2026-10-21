/** Apply real repayment transactions to a starting principal, amortising the
 * principal portion of each. Pure — the caller filters payments to those on/after
 * the anchor date and sorts them ascending by date.
 *
 * Sign convention: outflow amount < 0 (magnitude p = -amount reduces principal);
 * a refund amount > 0 (p < 0) restores principal. Interest is time-based
 * (Actual/365): each payment accrues `balance × annualRate% × daysSincePrev/365`,
 * where the previous event starts at `anchorDate`. Shares the interest/principal
 * split convention with src/lib/mortgage/simulate.ts. */

export interface AmortPayment {
  amount: number; // raw signed transaction amount
  date: string;   // ISO yyyy-mm-dd (the transaction's occurred_at, date part)
}

export interface ProjectInput {
  anchorBalance: number;
  annualRate: number; // % p.a.
  anchorDate: string; // ISO yyyy-mm-dd — seeds the first interest interval
  payments: AmortPayment[];
}

export interface ProjectResult {
  balance: number; // current owing magnitude, >= 0
  paidOff: boolean;
  totalInterest: number;
}

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whole days between two ISO dates (UTC midnight diff), clamped >= 0. */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.max(0, Math.round(ms / DAY_MS));
}

export function projectBalance(input: ProjectInput): ProjectResult {
  const rate = Math.max(0, input.annualRate) / 100;
  let balance = Math.max(0, input.anchorBalance);
  let totalInterest = 0;
  let prev = input.anchorDate;

  for (const t of input.payments) {
    const days = daysBetween(prev, t.date);
    const interest = balance > 0 ? balance * rate * (days / 365) : 0;
    const p = -t.amount; // outflow -> positive paydown; refund -> negative
    const principal = p - interest;
    if (interest > 0) totalInterest += interest;
    balance = Math.max(0, balance - principal);
    prev = t.date;
  }

  return {
    balance: round2(balance),
    paidOff: balance <= 0,
    totalInterest: round2(totalInterest),
  };
}
