// Orchestration runner. Decides cap + reserve events from injected data, builds
// alert rows, sends ONE coalesced morning Telegram message for the deliverable
// ones, and records every event (markers included). IO is injected so this is
// testable with in-memory fakes — see run.test.ts.

import { decideCapAlerts, type BudgetSnapshot, type ThresholdState } from "./evaluate";
import { decideReserveWithdrawals, type ReserveTxn } from "./reserve";
import {
  formatCapBreach,
  formatCapWarning,
  formatReserveWithdrawal,
  formatMorningDigest,
} from "./format";
import type { SendResult } from "./telegram";

export interface AlertRow {
  household_id: string;
  type: "cap_breach" | "cap_warning" | "cap_ok" | "reserve_withdrawal" | "flex_digest" | "monthly_review" | "subscription_new" | "subscription_duplicate" | "budget_coverage_gap" | "reserve_sweep";
  category_id: string | null;
  period_start: string | null;
  state: ThresholdState | null;
  txn_id: string | null;
  subscription_id?: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  delivered: boolean;
  delivery_error: string | null;
}

export interface AlertDeps {
  householdId: string;
  periodStart: string;
  snapshots: BudgetSnapshot[];
  lastStates: Map<string, ThresholdState>;
  reserveTxns: ReserveTxn[];
  alertedTxnIds: Set<string>;
  insertAlerts: (rows: AlertRow[]) => Promise<void>;
  send: (text: string) => Promise<SendResult>;
}

export interface AlertSummary {
  fired: number;
  delivered: number;
  errors: number;
}

export async function runAlertEvaluation(deps: AlertDeps): Promise<AlertSummary> {
  const capEvents = decideCapAlerts(deps.snapshots, deps.lastStates);
  const reserveEvents = decideReserveWithdrawals(deps.reserveTxns, deps.alertedTxnIds);

  // Build the deliverable lines (in a stable order) and the rows to persist.
  const deliverableLines: string[] = [];
  const deliverableRows: AlertRow[] = [];
  const markerRows: AlertRow[] = [];

  for (const e of capEvents) {
    if (!e.deliver) {
      markerRows.push({
        household_id: deps.householdId,
        type: "cap_ok",
        category_id: e.categoryId,
        period_start: deps.periodStart,
        state: e.state,
        txn_id: null,
        title: `${e.snapshot.category} recovered`,
        body: "",
        payload: { pct: e.snapshot.pct },
        delivered: false,
        delivery_error: null,
      });
      continue;
    }
    const line = e.type === "cap_breach" ? formatCapBreach(e.snapshot) : formatCapWarning(e.snapshot);
    deliverableLines.push(line);
    deliverableRows.push({
      household_id: deps.householdId,
      type: e.type,
      category_id: e.categoryId,
      period_start: deps.periodStart,
      state: e.state,
      txn_id: null,
      title: `${e.snapshot.category} ${e.type === "cap_breach" ? "over budget" : "near limit"}`,
      body: line,
      payload: { target: e.snapshot.target, netSpent: e.snapshot.netSpent, pct: e.snapshot.pct },
      delivered: false,
      delivery_error: null,
    });
  }

  for (const e of reserveEvents) {
    const line = formatReserveWithdrawal(e);
    deliverableLines.push(line);
    deliverableRows.push({
      household_id: deps.householdId,
      type: "reserve_withdrawal",
      category_id: e.categoryId,
      period_start: deps.periodStart,
      state: null,
      txn_id: e.txnId,
      title: `${e.category} drawn down`,
      body: line,
      payload: { amount: e.amount, reserveBalance: e.reserveBalance, merchant: e.merchant },
      delivered: false,
      delivery_error: null,
    });
  }

  // Deliver once, coalesced.
  let result: SendResult = { ok: true };
  if (deliverableLines.length > 0) {
    result = await deps.send(formatMorningDigest(deliverableLines));
    for (const row of deliverableRows) {
      row.delivered = result.ok;
      row.delivery_error = result.ok ? null : result.error ?? "unknown";
    }
  }

  const rows = [...deliverableRows, ...markerRows];
  if (rows.length > 0) await deps.insertAlerts(rows);

  return {
    fired: deliverableRows.length,
    delivered: result.ok ? deliverableRows.length : 0,
    errors: result.ok ? 0 : deliverableRows.length,
  };
}
