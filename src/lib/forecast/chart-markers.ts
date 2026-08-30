// Income (pay) days, derived from the balance series itself. With daily
// discretionary burn every non-pay day trends down, so any day whose balance
// rises above the previous day is an income day. Keeps the forecast chart a pure
// presentational component — no extra data needed. Returns the ascending indices
// of pay days (never index 0, which has no prior day).
export function paydayIndexes(balances: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < balances.length; i++) {
    if (balances[i] > balances[i - 1]) out.push(i);
  }
  return out;
}
