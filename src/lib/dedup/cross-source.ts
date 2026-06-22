// Cross-source duplicate detection: a transaction present in BOTH the
// PocketSmith import (akahu_transaction_id = "ps_*") and the live Akahu feed.
// See docs/superpowers/specs/2026-06-03-cross-source-dedup-design.md.

const DAY_MS = 86_400_000;

export type DedupRow = {
  id: string;
  akahu_transaction_id: string;
  household_id: string;
  account_id: string;
  occurred_at: string; // ISO timestamp
  amount: number | string;
  description: string | null;
  category_id: string | null;
  is_manual_category: boolean;
};

export type DedupConfidence = "high" | "fuzzy";

export type DedupAction =
  | { kind: "resolve"; akahuId: string; psId: string; portCategoryId: string | null }
  | { kind: "flag"; akahuId: string };

export type DedupOpts = { toleranceDays: number; descThreshold: number };
const DEFAULT_OPTS: DedupOpts = { toleranceDays: 7, descThreshold: 0.6 };

// Bank-mechanism / filler tokens that survive length filtering but carry no
// merchant signal. PocketSmith rows prefix card txns with "CARD <nnnn>" that the
// live Akahu rows lack, so "card" would otherwise drag down real matches.
const NOISE_TOKENS = new Set(["card", "and", "the", "for"]);

export function isPocketSmithRow(r: { akahu_transaction_id: string }): boolean {
  return r.akahu_transaction_id.startsWith("ps_");
}

/** Lowercase, drop digits/punctuation/noise, keep word tokens >= 3 chars. */
export function descTokens(description: string | null): Set<string> {
  if (!description) return new Set();
  const cleaned = description
    .toLowerCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return new Set(cleaned.split(" ").filter((w) => w.length >= 3 && !NOISE_TOKENS.has(w)));
}

/** Jaccard similarity of two token sets (0..1). */
export function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function cents(n: number | string): number {
  return Math.round(Number(n) * 100);
}

/** Find the best PocketSmith duplicate of an Akahu row among candidates. */
export function isCrossSourceDuplicate(
  akahuRow: DedupRow,
  candidatePsRows: DedupRow[],
  opts: DedupOpts = DEFAULT_OPTS,
): { match: DedupRow | null; confidence: DedupConfidence | null } {
  const aCents = cents(akahuRow.amount);
  const aTime = new Date(akahuRow.occurred_at).getTime();
  const aTokens = descTokens(akahuRow.description);

  // Cross-source duplicates always sit on different account ids (PocketSmith
  // rows use a synthetic "PocketSmith History" account; Akahu rows the real
  // one), so account identity is no signal. Description similarity is: pick the
  // amount+date candidate with the strongest token overlap, then grade it.
  let best: { row: DedupRow; overlap: number } | null = null;
  for (const ps of candidatePsRows) {
    if (!isPocketSmithRow(ps)) continue;
    if (ps.household_id !== akahuRow.household_id) continue;
    if (cents(ps.amount) !== aCents) continue;
    const dtDays = Math.abs(new Date(ps.occurred_at).getTime() - aTime) / DAY_MS;
    if (dtDays > opts.toleranceDays) continue;

    const overlap = tokenOverlap(aTokens, descTokens(ps.description));
    if (!best || overlap > best.overlap) best = { row: ps, overlap };
  }
  if (!best) return { match: null, confidence: null };
  const confidence: DedupConfidence = best.overlap >= opts.descThreshold ? "high" : "fuzzy";
  return { match: best.row, confidence };
}

/** Turn a set of overlap-window rows into resolve/flag actions. */
export function planDedupActions(
  akahuRows: DedupRow[],
  psRows: DedupRow[],
  opts: DedupOpts = DEFAULT_OPTS,
): DedupAction[] {
  const actions: DedupAction[] = [];
  for (const a of akahuRows) {
    const { match, confidence } = isCrossSourceDuplicate(a, psRows, opts);
    if (!match) continue;
    if (confidence === "high") {
      const portCategoryId = a.is_manual_category ? null : (match.category_id ?? null);
      actions.push({ kind: "resolve", akahuId: a.id, psId: match.id, portCategoryId });
    } else if (!a.category_id) {
      // Fuzzy match only flags an UNcategorised row for review. A row that already
      // has a category needs no review — flagging it would re-surface a filed
      // transaction on every poll (a coincidental same-amount PS row that shares
      // only a surname token would never stop nagging). See the dedup re-flag loop
      // root-caused on the recurring "Warner B G SavingsRC" transfer.
      actions.push({ kind: "flag", akahuId: a.id });
    }
  }
  return actions;
}

/** Execute dedup actions against Supabase. */
export async function applyDedupActions(
  supabase: { from: (t: string) => any },
  actions: DedupAction[],
): Promise<void> {
  // scoped-db-exempt: by-primary-key mutations on transaction ids that were
  // already loaded + household-matched upstream (planDedupActions only pairs rows
  // with equal household_id); the id is a globally-unique PK and no householdId is
  // threaded into this thin executor (supabase is typed as a bare { from }).
  for (const act of actions) {
    if (act.kind === "resolve") {
      if (act.portCategoryId) {
        await supabase.from("transactions") // scoped-db-exempt: by-PK (see above)
          .update({ category_id: act.portCategoryId, is_manual_category: true })
          .eq("id", act.akahuId);
      }
      await supabase.from("transactions").delete().eq("id", act.psId); // scoped-db-exempt: by-PK (see above)
    } else {
      await supabase.from("transactions").update({ needs_review: true }).eq("id", act.akahuId); // scoped-db-exempt: by-PK (see above)
    }
  }
}
