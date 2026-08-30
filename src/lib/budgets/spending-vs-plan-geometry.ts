import type { Position } from "./position";

export interface SpendZone {
  label: string;
  value: number;
  /** width as % of scaleMax (clamped to 100). */
  widthPct: number;
}

export interface SpendingVsPlanGeometry {
  /** Track denominator: planned income, or budget when no plan. */
  scaleMax: number;
  hasPlan: boolean;
  spent: SpendZone;        // expenses.actual
  capsUnspent: SpendZone;  // max(0, budget − spent)
  headroom: SpendZone;     // max(0, planned − budget); 0 when no plan
  /** spend beyond caps (0 normally). */
  overCap: number;
  /** caps boundary as % of scaleMax. */
  capsTickPct: number;
  /** planned − budget (= position.net.planned). */
  structurePerMo: number;
  /** spent ÷ budget × 100, rounded. */
  capsUsedPct: number;
  budget: number;
  planned: number;
}

// Pure geometry for the nested "income ⊇ caps ⊇ spent" bar. Spent, caps-unspent,
// and headroom tile left→right on a planned-income scale (budget scale when there
// is no income plan, in which case headroom collapses).
export function spendingVsPlanGeometry(position: Position): SpendingVsPlanGeometry {
  const spent = Math.max(0, position.expenses.actual);
  const budget = Math.max(0, position.expenses.budget);
  const planned = Math.max(0, position.income.planned);
  const hasPlan = planned > 0 && budget > 0;

  const scaleMax = Math.max(hasPlan ? planned : budget, spent, 1);
  const pct = (v: number) => Math.min(100, (v / scaleMax) * 100);

  const capsUnspent = Math.max(0, budget - spent);
  const headroom = hasPlan ? Math.max(0, planned - budget) : 0;

  return {
    scaleMax,
    hasPlan,
    spent: { label: "spent", value: spent, widthPct: pct(spent) },
    capsUnspent: { label: "caps unspent", value: capsUnspent, widthPct: pct(capsUnspent) },
    headroom: { label: "headroom", value: headroom, widthPct: pct(headroom) },
    overCap: Math.max(0, spent - budget),
    capsTickPct: pct(budget),
    structurePerMo: position.net.planned,
    capsUsedPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
    budget,
    planned,
  };
}
