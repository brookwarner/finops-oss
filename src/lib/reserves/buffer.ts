import type { ScopedDb } from "@/lib/supabase/scoped";
import { RESERVE_ACCRUAL_START } from "@/lib/budgets/period";

export interface BehindReserve {
  categoryId: string;
  shortfall: number; // > 0 means behind
}

export interface ContributionAllocation {
  credited: Map<string, number>; // categoryId → dollars credited (>= 0)
  uncommitted: number;           // pot left after every shortfall is filled
}

/**
 * Allocate a contribution pot across behind reserves, largest shortfall first,
 * each capped at its own shortfall. Mirrors the surplus-allocation cascade order
 * in allocation/compute.ts so the budgets page and the /investments panel agree.
 * Leftover (pot beyond total shortfall) is returned as `uncommitted`.
 */
export function allocateContributions(
  reserves: BehindReserve[],
  pot: number,
): ContributionAllocation {
  const credited = new Map<string, number>();
  let rem = Math.max(0, pot);
  const ordered = reserves
    .filter((r) => r.shortfall > 0)
    // Largest shortfall first; categoryId breaks ties so ordering is deterministic
    // across JS engines (the cascade order is shown to the user on /budgets).
    .sort((a, b) => b.shortfall - a.shortfall || a.categoryId.localeCompare(b.categoryId));
  for (const r of ordered) {
    if (rem <= 0) break;
    const amt = Math.min(rem, r.shortfall);
    credited.set(r.categoryId, amt);
    rem -= amt;
  }
  return { credited, uncommitted: rem };
}

/**
 * Contribution total = sum of INFLOWS (amount > 0) on the buffer account.
 * Outflows (drawdowns) are ignored: when a reserve cost lands it hits the
 * category spend, which already reduces the reserve — counting the buffer
 * withdrawal too would double-charge. (Caveat: interest credited to the buffer
 * posts as a small inflow and is counted; negligible at these balances.)
 */
export function sumContributions(txns: { amount: number }[]): number {
  let total = 0;
  for (const t of txns) if (t.amount > 0) total += Number(t.amount);
  return total;
}

export interface BufferContext {
  accountId: string | null;
  contributions: number;    // inflows since RESERVE_ACCRUAL_START
  sweptThisCycle: number;   // inflows since the current cycle start
  bufferBalance: number;    // current balance of the buffer account
}

/**
 * Load the designated buffer account and its inflow totals. Returns zeros + a
 * null accountId when no account is flagged (the pre-designation state), so
 * callers degrade gracefully. The inflow scan can span the whole year, so it
 * pages past the 1000-row PostgREST cap.
 */
export async function loadBufferContext(
  db: ScopedDb,
  cycleStart: Date,
  periodEnd: Date,
): Promise<BufferContext> {
  const { data: accts, error } = await db.accounts
    .select("id, balance_current, is_reserve_buffer")
    .eq("is_reserve_buffer", true);
  if (error) throw new Error(error.message);
  const buffer = (accts ?? [])[0];
  if (!buffer) {
    return { accountId: null, contributions: 0, sweptThisCycle: 0, bufferBalance: 0 };
  }
  const rows: { amount: number; occurred_at: string }[] = await db.transactions.selectAllPaged((q) =>
    q.select("amount, occurred_at")
      .eq("account_id", buffer.id)
      .gt("amount", 0)
      .gte("occurred_at", RESERVE_ACCRUAL_START.toISOString())
      .lt("occurred_at", periodEnd.toISOString()),
  );
  const contributions = sumContributions(rows);
  const sweptThisCycle = sumContributions(
    rows.filter((r) => new Date(r.occurred_at) >= cycleStart),
  );
  return {
    accountId: buffer.id,
    contributions,
    sweptThisCycle,
    bufferBalance: Number(buffer.balance_current ?? 0),
  };
}
