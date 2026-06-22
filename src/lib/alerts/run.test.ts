import { describe, it, expect, vi } from "vitest";
import { runAlertEvaluation, type AlertDeps } from "@/lib/alerts/run";
import type { BudgetSnapshot } from "@/lib/alerts/evaluate";
import type { ReserveTxn } from "@/lib/alerts/reserve";

function overSnap(): BudgetSnapshot {
  return { categoryId: "groceries", category: "Groceries", state: "over",
    target: 1200, netSpent: 1240, pct: 103, remaining: -40, daysLeft: 6 };
}
function reserveTxn(): ReserveTxn {
  return { id: "txn-1", categoryId: "car", category: "Car maintenance",
    amount: -420, occurredAt: "2026-06-03", merchant: "Repco", reserveBalance: 640 };
}

function deps(over: Partial<AlertDeps> = {}): AlertDeps & { inserted: any[]; sent: string[] } {
  const inserted: any[] = [];
  const sent: string[] = [];
  return {
    householdId: "hh-1",
    periodStart: "2026-05-20",
    snapshots: [],
    lastStates: new Map(),
    reserveTxns: [],
    alertedTxnIds: new Set(),
    insertAlerts: async (rows) => { inserted.push(...rows); },
    send: async (text) => { sent.push(text); return { ok: true }; },
    inserted,
    sent,
    ...over,
  };
}

describe("runAlertEvaluation — deliverable alerts", () => {
  it("coalesces a cap breach and a reserve withdrawal into ONE telegram send", async () => {
    const d = deps({ snapshots: [overSnap()], lastStates: new Map([["groceries", "warning"]]),
      reserveTxns: [reserveTxn()] });
    const summary = await runAlertEvaluation(d);

    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]).toContain("Groceries");
    expect(d.sent[0]).toContain("Car maintenance");
    expect(summary).toMatchObject({ fired: 2, delivered: 2, errors: 0 });
  });

  it("persists a row per fired alert, stamped delivered", async () => {
    const d = deps({ snapshots: [overSnap()], lastStates: new Map([["groceries", "warning"]]) });
    await runAlertEvaluation(d);
    expect(d.inserted).toHaveLength(1);
    expect(d.inserted[0]).toMatchObject({
      household_id: "hh-1", type: "cap_breach", category_id: "groceries",
      period_start: "2026-05-20", state: "over", delivered: true,
    });
  });
});

describe("runAlertEvaluation — markers are recorded but not sent", () => {
  it("records a cap_ok marker on recovery without sending anything", async () => {
    const okSnap = { ...overSnap(), state: "ok" as const };
    const d = deps({ snapshots: [okSnap], lastStates: new Map([["groceries", "over"]]) });
    const summary = await runAlertEvaluation(d);

    expect(d.sent).toHaveLength(0);
    expect(d.inserted).toHaveLength(1);
    expect(d.inserted[0]).toMatchObject({ type: "cap_ok", delivered: false });
    expect(summary).toMatchObject({ fired: 0, delivered: 0 });
  });
});

describe("runAlertEvaluation — nothing changed", () => {
  it("does not insert or send when no thresholds move", async () => {
    const d = deps({ snapshots: [{ ...overSnap(), state: "ok" }],
      lastStates: new Map([["groceries", "ok"]]) });
    const summary = await runAlertEvaluation(d);
    expect(d.inserted).toHaveLength(0);
    expect(d.sent).toHaveLength(0);
    expect(summary).toMatchObject({ fired: 0, delivered: 0, errors: 0 });
  });
});

describe("runAlertEvaluation — delivery failure", () => {
  it("records the alert as undelivered with the error and counts it", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, error: "bad chat" });
    const d = deps({ snapshots: [overSnap()], lastStates: new Map([["groceries", "warning"]]), send });
    const summary = await runAlertEvaluation(d);

    expect(d.inserted[0]).toMatchObject({ delivered: false, delivery_error: "bad chat" });
    expect(summary).toMatchObject({ fired: 1, delivered: 0, errors: 1 });
  });
});
