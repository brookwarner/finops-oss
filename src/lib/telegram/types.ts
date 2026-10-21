// Shared types for the inbound Telegram surface.

/** A read request the bot can answer immediately (no confirmation). */
export type ReadQuery =
  | { kind: "budgets" }
  | { kind: "budget_status"; category: string }
  | { kind: "subscriptions" }
  | { kind: "net_worth" }
  | { kind: "forecast" }
  | { kind: "recent"; category?: string; limit?: number };

/** What the LLM is allowed to propose — nothing else. */
export type Interpretation =
  | { kind: "set_budget_target"; category: string; monthlyTarget: number }
  | { kind: "recategorise"; txnHint: string; categoryName: string }
  | { kind: "accept_suggestions"; category: string }
  | { kind: "read_query"; query: ReadQuery }
  | { kind: "clarify"; question: string };

/** A write resolved to concrete ids, stored in the pending row and applied on confirm. */
export type ResolvedAction =
  | { kind: "set_budget_target"; categoryId: string; categoryName: string; monthlyTarget: number; previousTarget: number }
  | { kind: "recategorise"; transactionId: string; txnLabel: string; categoryId: string; categoryName: string }
  | { kind: "accept_suggestions"; categoryName: string; transactionIds: string[] };
