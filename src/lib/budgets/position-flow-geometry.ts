import type { Position } from "./position";

export interface FlowBar {
  /** actual-so-far as % of the shared scale (0–100). */
  solidPct: number;
  /** projected remainder as % of the shared scale; 0 when projected ≤ actual. */
  ghostPct: number;
  actual: number;
  projected: number;
}

export interface PositionFlowGeometry {
  /** Shared dollar denominator for both bars (incl. 4% headroom). */
  scaleMax: number;
  in: FlowBar;
  out: FlowBar;
  /** Signed projected net (= position.net.projected). */
  projectedNet: number;
  /** Bracket spanning the two projected bar-ends; surplus=true when In ≥ Out. */
  overhang: { startPct: number; widthPct: number; surplus: boolean };
}

// Pure geometry for the Position card's two In/Out bars on a shared scale. Each
// bar shows solid actual-so-far + a hatched projected remainder; the gap between
// the two projected ends is the overhang that visualises the hero net number.
export function positionFlowGeometry(position: Position): PositionFlowGeometry {
  const inActual = Math.max(0, position.income.actual);
  // Asymmetry by design: the In bar projects to the full-cycle income
  // *expectation* (income.expected = max(actual, plan)), while the Out bar
  // projects to the spend-model *projection* (expenses.projected). Income has no
  // run-rate projection — it lands in known lumps toward the plan — so `expected`
  // is its honest end-of-cycle figure; spend genuinely run-rates, so it uses
  // `projected`. Both clamp so the ghost can never go negative.
  const inProjected = Math.max(inActual, position.income.expected);
  const outActual = Math.max(0, position.expenses.actual);
  const outProjected = Math.max(outActual, position.expenses.projected);

  const scaleMax = Math.max(inProjected, outProjected, 1) * 1.04;
  const pct = (v: number) => (v / scaleMax) * 100;
  const bar = (actual: number, projected: number): FlowBar => ({
    solidPct: pct(actual),
    ghostPct: Math.max(0, pct(projected) - pct(actual)),
    actual,
    projected,
  });

  const lo = Math.min(pct(inProjected), pct(outProjected));
  const hi = Math.max(pct(inProjected), pct(outProjected));

  return {
    scaleMax,
    in: bar(inActual, inProjected),
    out: bar(outActual, outProjected),
    projectedNet: position.net.projected,
    overhang: { startPct: lo, widthPct: hi - lo, surplus: position.net.projected >= 0 },
  };
}
