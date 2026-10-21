import type { NetWorthResult } from "./compute";

export interface NetWorthBreakdownEntry {
  account: string;
  type: string;
  balance: number;
  currency: "NZD";
}

/** A row ready to upsert into `net_worth_snapshots`. */
export interface NetWorthSnapshotRow {
  household_id: string;
  snapshot_date: string;
  assets: number;
  liabilities: number;
  net: number;
  breakdown: NetWorthBreakdownEntry[];
}

/**
 * Shape a computeNetWorth() result into a daily snapshot row, keeping a signed
 * per-account breakdown so the trend can later be split by account/type.
 */
export function buildNetWorthSnapshot(
  result: NetWorthResult,
  ctx: { householdId: string; snapshotDate: string },
): NetWorthSnapshotRow {
  return {
    household_id: ctx.householdId,
    snapshot_date: ctx.snapshotDate,
    assets: result.assets,
    liabilities: result.liabilities,
    net: result.net,
    breakdown: result.accounts.filter(a => a.currency === "NZD").map((a) => ({
      account: a.name,
      type: a.type,
      balance: a.balance,
      currency: "NZD",
    })),
  };
}

/** Older snapshots mixed currencies; keep them stored, outside the NZD trend. */
export function isNZDSnapshot(breakdown: unknown): boolean {
  return Array.isArray(breakdown) && breakdown.every(a => a?.currency === "NZD");
}
