// src/lib/forecast/postings.ts
// Derive the set of dated postings that make up ONE monthly cycle of a committed
// bill category, from that category's recent actual transactions.
//
// Why this exists: a committed category is not one payment. "Insurance" is five
// separate direct debits on the 20th (life + two car + pet + income protection);
// "Telephone Services" is fibre + a mobile plan. Seeding the projection from the
// single most-recent posting (the old behaviour) projected ONE of them forward and
// silently dropped the rest — a category with $560 of insurance leaving the account
// on the 20th showed up in the forecast as the last $5 debit.
//
// The rule: group a category's outflows by merchant, keep the most recent monthly
// cycle of each merchant, then total by day-of-month. Multi-debit categories get
// their real amount; single-bill categories are unchanged.

import { normaliseMerchant } from "@/lib/subscriptions/detect";

const DAY_MS = 86_400_000;

/** A committed bill's outflow on one day-of-month, as a positive magnitude. */
export interface BillPosting {
  day: number;    // day-of-month, 1-31
  amount: number; // outflow magnitude (positive)
}

export interface PostingTxn {
  occurred_at: string;
  amount: number;                // signed; only outflows (< 0) are counted
  merchant?: string | null;      // optional — falls back to day-of-month grouping
  description?: string | null;
}

/**
 * A merchant whose last charge is older than this hasn't billed in the current
 * cycle, so cloning it forward every month would invent an outflow. Covers a
 * monthly bill's longest gap (31d) plus grace; deliberately excludes quarterly and
 * annual bills, which must not be projected as monthly (the caller falls back to
 * the budget's monthly_target when nothing recent survives).
 */
export const BILL_STALE_DAYS = 45;

/**
 * Gap at which an earlier charge from the same merchant is treated as the PREVIOUS
 * monthly cycle rather than a second charge within this one. Below it (same-day
 * debits, a fortnightly bill) both charges count; at or above it the scan stops, so
 * a bill whose post-date drifts across the window edge can't be counted twice.
 */
export const MONTHLY_CYCLE_MIN_DAYS = 24;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One monthly cycle's worth of postings for a single category, totalled per
 * day-of-month. Pure and deterministic given `now`. Returns [] when the category
 * has no recent outflow (caller falls back to the budget target).
 */
export function derivePostings(txns: PostingTxn[], now: Date): BillPosting[] {
  const staleBefore = now.getTime() - BILL_STALE_DAYS * DAY_MS;

  // Group by merchant so each recurring debit keeps its own cycle. Bank reference
  // noise is stripped by the shared subscriptions merchant key; when a row carries
  // no usable merchant text, day-of-month is the next-best proxy for "same bill".
  const groups = new Map<string, { ts: number; day: number; amount: number }[]>();
  for (const t of txns) {
    const amount = Number(t.amount);
    if (!(amount < 0)) continue; // outflows only; a refund isn't a bill
    const ts = Date.parse(t.occurred_at);
    if (!Number.isFinite(ts)) continue;
    const day = new Date(ts).getUTCDate();
    const key = normaliseMerchant(t.merchant ?? null, t.description ?? null) || `day:${day}`;
    const row = { ts, day, amount: Math.abs(amount) };
    const g = groups.get(key);
    if (g) g.push(row); else groups.set(key, [row]);
  }

  const byDay = new Map<number, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => b.ts - a.ts); // newest first
    if (group[0].ts < staleBefore) continue; // lapsed / non-monthly cadence
    let prevTs = group[0].ts;
    for (const p of group) {
      // Walk back from the newest charge while the gap stays sub-monthly, i.e.
      // while we're still inside the same billing cycle; stop at the previous one.
      if ((prevTs - p.ts) / DAY_MS >= MONTHLY_CYCLE_MIN_DAYS) break;
      byDay.set(p.day, round2((byDay.get(p.day) ?? 0) + p.amount));
      prevTs = p.ts;
    }
  }

  return Array.from(byDay, ([day, amount]) => ({ day, amount })).sort((a, b) => a.day - b.day);
}
