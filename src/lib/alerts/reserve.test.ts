import { describe, it, expect } from "vitest";
import { decideReserveWithdrawals, type ReserveTxn } from "@/lib/alerts/reserve";

function txn(over: Partial<ReserveTxn> = {}): ReserveTxn {
  return {
    id: "txn-1",
    categoryId: "cat-car",
    category: "Car maintenance",
    amount: -420, // Akahu signs debits negative; an outflow/drawdown
    occurredAt: "2026-06-03",
    merchant: "Repco",
    reserveBalance: 640,
    ...over,
  };
}

describe("decideReserveWithdrawals", () => {
  it("fires once for a new outflow in a reserve category", () => {
    const events = decideReserveWithdrawals([txn()], new Set());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "reserve_withdrawal", txnId: "txn-1" });
  });

  it("does not re-fire a transaction that already has an alert", () => {
    const events = decideReserveWithdrawals([txn()], new Set(["txn-1"]));
    expect(events).toEqual([]);
  });

  it("ignores inflows/refunds (positive amount) — only drawdowns ping", () => {
    const events = decideReserveWithdrawals([txn({ id: "txn-2", amount: 50 })], new Set());
    expect(events).toEqual([]);
  });

  it("ignores zero-amount rows", () => {
    expect(decideReserveWithdrawals([txn({ amount: 0 })], new Set())).toEqual([]);
  });

  it("fires for each distinct new withdrawal", () => {
    const events = decideReserveWithdrawals(
      [txn({ id: "a" }), txn({ id: "b", amount: -90 })],
      new Set(),
    );
    expect(events.map((e) => e.txnId)).toEqual(["a", "b"]);
  });

  it("carries the drawdown amount and remaining balance into the event", () => {
    const [e] = decideReserveWithdrawals([txn({ amount: -420, reserveBalance: 640 })], new Set());
    expect(e.amount).toBe(420); // surfaced as a positive drawdown magnitude
    expect(e.reserveBalance).toBe(640);
  });
});
