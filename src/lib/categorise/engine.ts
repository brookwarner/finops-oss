// Rule-based categorisation. Layered: curated exact-merchant rules run first
// (priority 50), then description-pattern rules from PocketSmith bootstrap
// (priority 60-100), then a bank-hint step mapping Akahu's category to ours.
// First match wins; bank hint is consulted only when no rule matches.
//
// Pipeline: exact → pattern → bank hint → [LLM nightly, elsewhere] → inbox.
//
// Two cross-cutting refinements:
//   * Amount gate — a rule may carry a half-open [min_amount, max_amount) window
//     over abs(amount) so one merchant can split by spend size (a $9 BP is a
//     pie, an $85 BP is a tank).
//   * Review flag — a match against a cached LLM rule (source='llm') is an
//     unconfirmed Claude guess, so it stays flagged for review until the user
//     approves it. Every other match (manual, curated, bootstrap, bank-hint)
//     is trusted.

export type Rule = {
  id: string;
  category_id: string;
  match_type: "exact" | "pattern";
  match_value: string;
  field: "merchant" | "description";
  priority: number;
  source?: string;
  // Optional absolute-amount gate, half-open [min_amount, max_amount). Lets one
  // merchant split by spend size — e.g. petrol stations: a $9 BP is a pie
  // (Restaurants), an $85 BP is a tank (Fuel). Null bound = unbounded that side.
  min_amount?: number | null;
  max_amount?: number | null;
};

export type TxnForCategorise = {
  id: string;
  merchant: string | null;
  description: string | null;
  is_manual_category: boolean;
  akahu_category_name?: string | null;
  // Signed amount (expenses negative). The amount gate compares its magnitude;
  // a rule carrying a bound can't apply when amount is null.
  amount?: number | null;
};

export type CategoriseResult = {
  category_id: string;
  // true only when matched by a cached LLM rule (still awaiting review).
  needs_review: boolean;
};

// A rule's amount gate is satisfied when the transaction magnitude falls in the
// rule's half-open [min, max) window. A rule with no bounds always passes.
function amountGateOk(rule: Rule, amount: number | null | undefined): boolean {
  if (rule.min_amount == null && rule.max_amount == null) return true;
  if (amount == null) return false; // bounded rule needs an amount to compare
  const mag = Math.abs(amount);
  if (rule.min_amount != null && mag < rule.min_amount) return false;
  if (rule.max_amount != null && mag >= rule.max_amount) return false;
  return true;
}

// Apply a sorted (by priority asc) rule list to a transaction, then fall back
// to the bank-hint map (Akahu category name → our category_id). Returns the
// resolved category plus whether it still needs review, or null if unmatched.
// Pattern matches are case-insensitive substring.
export function categorise(
  tx: TxnForCategorise,
  rules: Rule[],
  bankHint: Record<string, string> = {},
): CategoriseResult | null {
  if (tx.is_manual_category) return null; // caller decides whether to skip
  for (const r of rules) {
    const target = r.field === "merchant" ? tx.merchant : tx.description;
    if (!target) continue;
    if (!amountGateOk(r, tx.amount)) continue;
    const hit =
      r.match_type === "exact"
        ? target === r.match_value
        : target.toUpperCase().includes(r.match_value.toUpperCase());
    if (hit) {
      return { category_id: r.category_id, needs_review: r.source === "llm" };
    }
  }
  // Bank-hint fallback — trusted, never needs review.
  if (tx.akahu_category_name) {
    const hint = bankHint[tx.akahu_category_name];
    if (hint) return { category_id: hint, needs_review: false };
  }
  return null;
}

/** A pending (unsettled) row for provisional categorisation: it has a raw
 *  description and a signed amount, but NO merchant (Akahu doesn't enrich
 *  pending). */
export type PendingForCategorise = {
  description: string | null;
  amount?: number | null;
};

// Provisional categorisation for PENDING rows, used only to attribute pending
// spend to budgets (never persisted — pending is wipe-replaced each poll).
//
// The twist vs `categorise`: pending rows have no merchant, but their merchant
// name is the PREFIX of the description ("LIQUORLAND WESTCITY…", "BUNNINGS -
// 9502…"). So a `merchant`-field rule is tested as a case-insensitive prefix of
// the description — anchored, so a short token like "BP" can't false-positive on
// "SUPER BP DELI". `description`-field rules keep their normal exact/substring
// semantics. First match by priority wins; returns the category_id or null
// (caller buckets nulls as "unallocated pending"). LLM-sourced rules still match
// (the result is provisional regardless, so the review flag is irrelevant here).
export function categorisePending(tx: PendingForCategorise, rules: Rule[]): string | null {
  const desc = tx.description;
  if (!desc) return null;
  const upper = desc.toUpperCase();
  // Defensive: resolve in priority order (lowest number first) regardless of how
  // the caller passed the rules, so curated rules outrank bootstrap/LLM ones.
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of ordered) {
    if (!amountGateOk(r, tx.amount)) continue;
    const value = r.match_value.toUpperCase();
    const hit =
      r.field === "merchant"
        ? // No merchant on pending → match the rule's merchant against the
          // description prefix (exact and pattern both anchor at the start; the
          // merchant always leads the pending description).
          upper.startsWith(value)
        : r.match_type === "exact"
          ? upper === value
          : upper.includes(value);
    if (hit) return r.category_id;
  }
  return null;
}
