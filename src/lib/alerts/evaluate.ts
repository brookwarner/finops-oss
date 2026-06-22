// Pure cap-alert decision logic. Given the current per-budget threshold state
// and the last-recorded state for each budget (within the current period),
// decide which alerts fire. True state-change semantics: a budget only re-fires
// after it has crossed back down (recorded as a non-delivered marker) and then
// crossed up again. No IO here — see record.ts for persistence/delivery.

export type ThresholdState = "ok" | "warning" | "over";

export interface BudgetSnapshot {
  categoryId: string;
  category: string;
  state: ThresholdState;
  target: number;
  netSpent: number;
  pct: number;
  remaining: number;
  daysLeft: number;
}

export type CapAlertType = "cap_breach" | "cap_warning" | "cap_ok";

export interface CapEvent {
  categoryId: string;
  type: CapAlertType;
  state: ThresholdState;
  deliver: boolean;
  snapshot: BudgetSnapshot;
}

const SEVERITY: Record<ThresholdState, number> = { ok: 0, warning: 1, over: 2 };

export function decideCapAlerts(
  snapshots: BudgetSnapshot[],
  lastStateByCategory: Map<string, ThresholdState>,
): CapEvent[] {
  const events: CapEvent[] = [];
  for (const snap of snapshots) {
    const last = lastStateByCategory.get(snap.categoryId) ?? "ok";
    const current = snap.state;
    if (current === last) continue;

    if (SEVERITY[current] > SEVERITY[last]) {
      // Upward cross — deliver the alert for the band we landed in.
      events.push({
        categoryId: snap.categoryId,
        type: current === "over" ? "cap_breach" : "cap_warning",
        state: current,
        deliver: true,
        snapshot: snap,
      });
    } else {
      // Downward/lateral — record the new state so a later re-cross can fire,
      // but do not notify (a recovery is not news worth a ping).
      events.push({
        categoryId: snap.categoryId,
        type: "cap_ok",
        state: current,
        deliver: false,
        snapshot: snap,
      });
    }
  }
  return events;
}
