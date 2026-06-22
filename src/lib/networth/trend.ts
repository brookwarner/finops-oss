/** A `net_worth_snapshots` row, as stored. */
export interface SnapshotRecord {
  snapshot_date: string;
  assets: number | null;
  liabilities: number | null;
  net: number | null;
}

export interface TrendPoint {
  date: string;
  net: number;
  assets: number;
  liabilities: number;
}

export interface NetWorthTrend {
  points: TrendPoint[];
  latest: TrendPoint | null;
  earliest: TrendPoint | null;
  /** latest.net − earliest.net over the window (0 with <2 points). */
  change: number;
  /** Percentage change vs the earliest net, or null when undefined. */
  changePct: number | null;
}

/**
 * Shape raw snapshot rows (any order) into an ascending-by-date trend series
 * plus the headline change across the window. Pure; the page supplies the rows.
 */
export function buildNetWorthTrend(rows: SnapshotRecord[]): NetWorthTrend {
  const points: TrendPoint[] = rows
    .map((r) => ({
      date: r.snapshot_date,
      net: Number(r.net ?? 0),
      assets: Number(r.assets ?? 0),
      liabilities: Number(r.liabilities ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const earliest = points[0] ?? null;
  const latest = points[points.length - 1] ?? null;
  // A trend needs at least two points to mean anything; a lone snapshot has no
  // movement to report.
  const hasSpan = points.length >= 2;
  const change = hasSpan ? latest!.net - earliest!.net : 0;
  // Guard against a zero/negative earliest base, where a percentage would be
  // meaningless or misleading.
  const changePct =
    hasSpan && earliest!.net > 0 ? (change / earliest!.net) * 100 : null;

  return { points, latest, earliest, change, changePct };
}
