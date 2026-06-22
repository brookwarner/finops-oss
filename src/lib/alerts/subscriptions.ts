import type { AlertRow } from "./run";
import { formatCurrency } from "@/lib/format";

export interface NewSubEvent {
  id: string;
  displayName: string;
  amount: number;
  cadence: string;
  nextExpected: string;
}

export interface DuplicateEvent {
  id: string;
  displayName: string;
  amount: number;
  cadence: string;
  windowStart: string;
}

export interface SubAlertInput {
  householdId: string;
  newSubs: NewSubEvent[];
  duplicates: DuplicateEvent[];
  priorNewKeys: Set<string>;
  priorDuplicateWindows: Map<string, string>;
}

function money(n: number): string {
  return formatCurrency(n, { decimals: 2, signDisplay: "never" });
}

export function decideSubscriptionAlerts(input: SubAlertInput): AlertRow[] {
  const rows: AlertRow[] = [];

  for (const s of input.newSubs) {
    if (input.priorNewKeys.has(s.id)) continue;
    rows.push({
      household_id: input.householdId,
      type: "subscription_new",
      category_id: null,
      period_start: null,
      state: null,
      txn_id: null,
      subscription_id: s.id,
      title: "New subscription detected",
      body: `New subscription detected: ${s.displayName} — ${money(s.amount)}/${s.cadence}, next ~${s.nextExpected}.`,
      payload: { displayName: s.displayName, amount: s.amount, cadence: s.cadence },
      delivered: false,
      delivery_error: null,
    });
  }

  for (const d of input.duplicates) {
    const prior = input.priorDuplicateWindows.get(d.id);
    if (prior && prior >= d.windowStart) continue;
    rows.push({
      household_id: input.householdId,
      type: "subscription_duplicate",
      category_id: null,
      period_start: d.windowStart,
      state: null,
      txn_id: null,
      subscription_id: d.id,
      title: "Possible double charge",
      body: `Possible double charge: ${d.displayName} billed twice this ${d.cadence} (${money(d.amount)} each). Are you paying for it twice?`,
      payload: { displayName: d.displayName, amount: d.amount, cadence: d.cadence, windowStart: d.windowStart },
      delivered: false,
      delivery_error: null,
    });
  }

  return rows;
}
