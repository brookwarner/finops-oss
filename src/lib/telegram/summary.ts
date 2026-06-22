import type { ResolvedAction } from "./types";

function money(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-NZ");
}

/** Pure: a human-readable, Markdown confirm line for a resolved write. */
export function summariseAction(a: ResolvedAction): string {
  switch (a.kind) {
    case "set_budget_target":
      return `Set *${a.categoryName}* cap ${money(a.previousTarget)} → *${money(a.monthlyTarget)}*.`;
    case "recategorise":
      return `Recategorise *${a.txnLabel}* → *${a.categoryName}*.`;
    case "accept_suggestions":
      return `Accept *${a.transactionIds.length}* inbox suggestion(s) in *${a.categoryName}*.`;
  }
}
