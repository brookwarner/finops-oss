/**
 * Cash held back on the everyday accounts at the projected bills-day trough, as a
 * margin for forecast error (income-cadence misses, a straggler bill). The sweep
 * never recommends moving money that would pull the trough below this floor — so
 * acting on the nudge can't leave the owner short on bills day. The single tunable.
 */
export const SWEEP_SAFETY_FLOOR = 500;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface SweepNudge {
  recommended: number; // plan target this cycle: Σ reserve rungs from the cascade
  sweptThisCycle: number; // inflows to the buffer detected this cycle
  outstanding: number; // max(0, recommended − swept): the plan gap still to fund
  remaining: number; // CASH-SAFE amount to sweep right now (≤ outstanding)
  cashHeadroom: number | null; // max(0, bills-day trough − floor); null ⇒ ungated (no forecast)
  cashCapped: boolean; // remaining < outstanding because cash, not the plan, is the binding limit
  billsBalance: number | null; // projected everyday-account trough through the next bill cluster (pre-sweep)
  billsDate: string | null; // ISO date of that trough (≈ bills day)
  cleared: boolean; // plan fully funded (outstanding === 0)
  perReserve: { category: string; covers: number }[]; // what the sweep covers
}

/**
 * Derive the sweep nudge from the cascade's reserve rungs and — when supplied — a
 * forward-cashflow trough, so the recommendation is what's *safe to move now*, not
 * just what the plan says is spare.
 *
 * Plan side: `recommended`/`perReserve` come from computeAllocation, `sweptThisCycle`
 * from BudgetComputeResult.reserveBuffer. Cash side: `trough` is
 * computeForecast().trough — the projected lowest everyday-account balance from now
 * through the next bill cluster (+grace). We never recommend sweeping past
 * `trough − safetyFloor`, so moving the suggested amount still clears bills day with
 * the floor intact. Omit `trough` to leave the nudge plan-only (degrades gracefully
 * when the forecast can't be built).
 *
 * Pure.
 */
export function computeSweepNudge(args: {
  recommended: number;
  sweptThisCycle: number;
  perReserve: { category: string; covers: number }[];
  trough?: { balance: number; date: string } | null;
  safetyFloor?: number;
}): SweepNudge {
  const recommended = Math.max(0, args.recommended);
  const sweptThisCycle = Math.max(0, args.sweptThisCycle);
  const outstanding = Math.max(0, round2(recommended - sweptThisCycle));

  // The swept money has already left the everyday accounts (it's a real txn), so
  // it's already reflected in `trough` — no need to subtract it twice here.
  const floor = args.safetyFloor ?? SWEEP_SAFETY_FLOOR;
  const cashHeadroom = args.trough != null ? Math.max(0, round2(args.trough.balance - floor)) : null;

  const remaining =
    cashHeadroom == null ? outstanding : Math.max(0, Math.min(outstanding, cashHeadroom));

  return {
    recommended,
    sweptThisCycle,
    outstanding,
    remaining,
    cashHeadroom,
    cashCapped: cashHeadroom != null && remaining < outstanding,
    billsBalance: args.trough ? round2(args.trough.balance) : null,
    billsDate: args.trough ? args.trough.date : null,
    cleared: recommended > 0 && outstanding === 0,
    perReserve: args.perReserve,
  };
}
