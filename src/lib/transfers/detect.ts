// Internal transfer detection. See
// docs/superpowers/specs/2026-06-03-transfer-detection-design.md.

const DAY_MS = 86_400_000;
const PAIR_WINDOW_DAYS = 3;

export type TransferTxn = {
  id: string;
  household_id: string;
  account_id: string;
  occurred_at: string;
  amount: number | string;
  description: string | null;
  category_id: string | null;
  category_kind: string | null; // "monthly_cap" | "reserve" | "ap_amortised" | "income" | null
};

export type TransferConfidence = "high" | "fuzzy";
export type TransferPair = { legs: [TransferTxn, TransferTxn]; confidence: TransferConfidence };

export type TransferAction =
  | { kind: "assign"; txnId: string; categoryId: string }
  | { kind: "flag"; txnId: string };

// Spend categories whose miscatted transfers we want to surface in the sweep.
const SPEND_KINDS = new Set(["monthly_cap", "reserve"]);

const KEYWORDS = [
  "transfer", "wbc inter", "frm ", "from ", " to ", "loan repayment",
  "payment received", "mb transfer", "internet transfer", "direct credit",
];

export function hasTransferKeyword(description: string | null): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return KEYWORDS.some((k) => d.includes(k));
}

// Significant digit runs (>= 5 digits) = account-number references.
function digitRuns(description: string | null): Set<string> {
  if (!description) return new Set();
  return new Set(description.match(/\d{5,}/g) ?? []);
}

/** Two legs corroborate if they share an account-ref digit run OR both read as transfers. */
export function corroborated(a: string | null, b: string | null): boolean {
  const da = digitRuns(a);
  for (const r of digitRuns(b)) if (da.has(r)) return true;
  return hasTransferKeyword(a) && hasTransferKeyword(b);
}

function cents(n: number | string): number {
  return Math.round(Number(n) * 100);
}

/** Find internal-transfer pairs in a window of household transactions. */
export function matchTransferPairs(txns: TransferTxn[]): TransferPair[] {
  const pairs: TransferPair[] = [];
  const used = new Set<string>();
  for (let i = 0; i < txns.length; i++) {
    const a = txns[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < txns.length; j++) {
      const b = txns[j];
      if (used.has(b.id)) continue;
      if (a.household_id !== b.household_id) continue;
      if (a.account_id === b.account_id) continue;
      const dtDays = Math.abs(new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()) / DAY_MS;
      if (dtDays > PAIR_WINDOW_DAYS) continue;

      // Only opposite-leg pairs (+X / -X) are real internal transfers: money
      // out of one account, into another. Same-sign same-amount cross-account
      // pairs proved to be cross-source duplicates or coincidental recurring
      // charges (validated on real data), not transfers — so they're excluded.
      const ca = cents(a.amount), cb = cents(b.amount);
      const opposite = ca === -cb && ca !== 0;
      if (!opposite) continue;

      const confidence: TransferConfidence = corroborated(a.description, b.description) ? "high" : "fuzzy";
      pairs.push({ legs: [a, b], confidence });
      used.add(a.id); used.add(b.id);
      break;
    }
  }
  return pairs;
}

export type PlanOpts = { mode: "ingest" | "sweep"; transfersCategoryId: string };

/** Turn detected pairs into actions per mode. */
export function planTransferActions(txns: TransferTxn[], opts: PlanOpts): TransferAction[] {
  const actions: TransferAction[] = [];
  for (const pair of matchTransferPairs(txns)) {
    for (const leg of pair.legs) {
      if (opts.mode === "ingest") {
        // Only ever touch uncategorised legs; high pairs auto-assign, fuzzy left for inbox.
        if (leg.category_id) continue;
        if (pair.confidence === "high") {
          actions.push({ kind: "assign", txnId: leg.id, categoryId: opts.transfersCategoryId });
        }
      } else {
        // sweep: uncategorised high -> assign; spend-categorised suspects -> flag.
        if (!leg.category_id && pair.confidence === "high") {
          actions.push({ kind: "assign", txnId: leg.id, categoryId: opts.transfersCategoryId });
        } else if (leg.category_id && leg.category_kind && SPEND_KINDS.has(leg.category_kind)) {
          actions.push({ kind: "flag", txnId: leg.id });
        }
      }
    }
  }
  return actions;
}

/** Execute transfer actions against Supabase. */
export async function applyTransferActions(
  supabase: { from: (t: string) => any },
  actions: TransferAction[],
): Promise<void> {
  // scoped-db-exempt: by-primary-key mutations on transaction ids already loaded +
  // household-matched upstream (matchTransferPairs only pairs rows with equal
  // household_id); id is a globally-unique PK and no householdId is threaded into
  // this thin executor (supabase is typed as a bare { from }).
  for (const act of actions) {
    if (act.kind === "assign") {
      await supabase.from("transactions")
        .update({ category_id: act.categoryId, is_manual_category: true })
        .eq("id", act.txnId);
    } else {
      await supabase.from("transactions").update({ needs_review: true }).eq("id", act.txnId); // scoped-db-exempt: by-PK (see above)
    }
  }
}
