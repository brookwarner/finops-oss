/** Kinds that are never spend: internal transfers and system rows. */
export const EXCLUDED_KINDS = new Set(["transfer", "system"]);

/**
 * Categories whose outflow is a pure financing cost deliberately NOT counted as
 * headline spend. Mortgage Interest is the only one — the mortgage is already
 * represented by the budgeted Mortgage Parts, so self-healing it would
 * double-count. Matched by name (the stable, migration-controlled identifier).
 */
export const COMMITTED_EXCLUDED_NAMES = new Set(["Mortgage Interest"]);

/** Round to the nearest cent — matches the numeric(14,2) DB type. */
function toCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ShadowInput {
  /** Outflow+inflow txns across the rolling window. Only amount < 0 are counted. */
  txns: { amount: number; category_id: string; occurred_at: string }[];
  /** categoryId → { kind, name }. */
  categoryKind: Map<string, { kind: string; name: string }>;
  /** Category ids that already have an active ap_amortised budget row. */
  budgetedApCatIds: Set<string>;
  /** Number of full cycles the rolling window spans (ROLLING_PERIODS). */
  rollingPeriods: number;
}

export interface ShadowBill {
  categoryId: string;
  name: string;
  monthlyAvg: number;
  occurrences: number;
  lastDay: number | null;
  lastAmount: number | null;
}

/**
 * Narrow a richer categoryId→meta map (e.g. `{kind, group, name}`) to the
 * `{kind, name}` shape `shadowCommittedByCat` needs. Callers hold maps with
 * extra fields; this is the one canonical projection so the two call sites
 * (position + compute) can't drift.
 */
export function toShadowCategoryKind(
  categoryKind: Map<string, { kind: string; name: string }>,
): Map<string, { kind: string; name: string }> {
  return new Map(Array.from(categoryKind, ([id, m]) => [id, { kind: m.kind, name: m.name }]));
}

/**
 * Detect "shadow" committed bills: recurring auto-payments that move real money
 * but have no active budget row, so they'd otherwise leak from the Position
 * projection and the payday forecast. A category qualifies iff it is
 * ap_amortised, not excluded, has no active ap budget, and has >=2 outflows in
 * the window. monthlyAvg amortises total outflow over the rolling window.
 */
export function shadowCommittedByCat(input: ShadowInput): Map<string, ShadowBill> {
  const { txns, categoryKind, budgetedApCatIds, rollingPeriods } = input;

  const sums = new Map<string, { total: number; count: number; lastTs: number; lastDay: number; lastAmount: number }>();
  for (const t of txns) {
    if (Number(t.amount) >= 0) continue;
    const meta = categoryKind.get(t.category_id);
    if (!meta) continue;
    if (meta.kind !== "ap_amortised") continue;
    if (COMMITTED_EXCLUDED_NAMES.has(meta.name)) continue;
    if (budgetedApCatIds.has(t.category_id)) continue;

    const outflow = toCents(-Number(t.amount));
    const ts = new Date(t.occurred_at).getTime();
    const prev = sums.get(t.category_id);
    if (!prev) {
      sums.set(t.category_id, {
        total: outflow, count: 1, lastTs: ts,
        lastDay: new Date(t.occurred_at).getUTCDate(), lastAmount: outflow,
      });
    } else {
      prev.total += outflow;
      prev.count += 1;
      if (ts > prev.lastTs) {
        prev.lastTs = ts;
        prev.lastDay = new Date(t.occurred_at).getUTCDate();
        prev.lastAmount = outflow;
      }
    }
  }

  const out = new Map<string, ShadowBill>();
  for (const [catId, s] of sums) {
    if (s.count < 2) continue;
    const meta = categoryKind.get(catId)!;
    out.set(catId, {
      categoryId: catId,
      name: meta.name,
      monthlyAvg: toCents(s.total / rollingPeriods),
      occurrences: s.count,
      lastDay: s.lastDay,
      lastAmount: s.lastAmount,
    });
  }
  return out;
}
