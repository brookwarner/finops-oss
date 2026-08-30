// src/lib/categorise/learn.ts
//
// Derives the category_rule to learn from a single manual categorisation.
//
// The historical inbox is PocketSmith imports whose `merchant` column is empty
// — the real merchant is buried in `description`. The learning loop used to key
// only on merchant, so those corrections taught the system nothing. This module
// adds a description-stem fallback, with guards so we never mint a rule from a
// bank-mechanism row ("WBC Internet Bill Payment", "MB TRANSFER") or a generic
// stem ("Balance", "from X") that would mis-fire on unrelated future txns.

export type LearnedRule = {
  match_type: "exact" | "pattern";
  match_value: string;
  field: "merchant" | "description";
};

// Substrings that mark a row as a payment mechanism / transfer, not a merchant.
const NOISE = [
  "bill payment",
  "one time pmt",
  "wbc internet",
  "mb transfer",
  "fn transfer",
  "internet transfer",
  "direct credit",
  "payment to",
  "loan/equity",
  "loan drawdow",
];

// Generic single words that are never a useful merchant pattern on their own.
const STOPWORDS = new Set([
  "balance",
  "reno",
  "payment",
  "transfer",
  "transfers",
  "deposit",
  "withdrawal",
  "refund",
  "credit",
  "debit",
  "interest",
  "fee",
  "reversal",
  "adjustment",
]);

const STEM_MAX = 24;

/** Pull a clean merchant-ish stem from a noisy bank description, or null. */
function descriptionStem(description: string | null): string | null {
  if (!description) return null;
  let s = description
    .replace(/^[0-9]+/, "") // strip a leading account/cheque code ("9340Jocelyn" -> "Jocelyn")
    .replace(/\s+\d.*$/, "") // cut at the first " <digit>" group (card/ref numbers, dates)
    .replace(/\s+/g, " ")
    .trim();

  const lower = s.toLowerCase();
  // Reject mechanism/transfer rows on the FULL string (before truncation, so a
  // truncated "wbc interne" can't slip past the substring check).
  if (lower.startsWith("from ") || lower.startsWith("to ")) return null;
  if (NOISE.some((n) => lower.includes(n))) return null;

  if (s.length > STEM_MAX) s = s.slice(0, STEM_MAX).trim();
  if (s.length < 6) return null;
  if (!/[a-z]{3,}/i.test(s)) return null; // needs at least one real word
  if (STOPWORDS.has(s.toLowerCase())) return null;
  return s;
}

/**
 * Given a manually-categorised transaction's merchant + description, return the
 * rule to upsert, or null if no safe rule can be derived. Prefers an exact
 * merchant rule; falls back to a description pattern when merchant is empty.
 */
export function deriveLearnedRule(
  merchant: string | null,
  description: string | null,
): LearnedRule | null {
  const m = (merchant ?? "").trim();
  if (m) return { match_type: "exact", match_value: m, field: "merchant" };

  const stem = descriptionStem(description);
  if (!stem) return null;
  return { match_type: "pattern", match_value: stem, field: "description" };
}
