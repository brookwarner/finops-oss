import { describe, expect, it } from "vitest";
import { snapshotSchema, snapshotInflows } from "@/lib/expected-income/contract";
import { expectedInflowByCycleEnd, projectExpectedInflows } from "@/lib/cashflow/inflows";
import { buildLines, type BuildLinesArgs } from "@/lib/cashflow/engine";

const payment = { id: "milestone-1", label: "Client milestone", amount: 5000,
  receivedAmount: 2000, currency: "NZD", expectedDate: "2026-10-20",
  status: "committed", taxRate: 0.2 };
const snapshot = { schemaVersion: 1, source: "brookos", generatedAt: "2026-10-10T00:00:00Z", payments: [payment] };
const now = new Date("2026-10-10T10:00:00Z");

describe("expected income contract and existing engines", () => {
  it("counts only outstanding amounts and uses existing net-income maths", () => {
    const inflows = snapshotInflows(snapshotSchema.parse(snapshot));
    expect(inflows[0].amount).toBe(3000);
    expect(expectedInflowByCycleEnd(inflows, new Date("2026-11-01"), now)).toBe(2400);
    expect(projectExpectedInflows(inflows, now, 30)[0]).toMatchObject({ date: "2026-10-20", delta: 2400 });
  });
  it.each(["settled", "cancelled"])("removes %s payments", (status) => {
    expect(snapshotInflows(snapshotSchema.parse({ ...snapshot, payments: [{ ...payment, status }] }))).toEqual([]);
  });
  it("keeps speculative income optional in both position and baseline forecasts", () => {
    const inflows = snapshotInflows(snapshotSchema.parse({ ...snapshot, payments: [{ ...payment, status: "speculative" }] }));
    expect(expectedInflowByCycleEnd(inflows, new Date("2026-11-01"), now)).toBe(0);
    expect(projectExpectedInflows(inflows, now, 30)).toEqual([]);
    expect(projectExpectedInflows(inflows, now, 30, { "brookos:milestone-1": "2026-10-20" })).toHaveLength(1);
  });
  it("retains overdue outstanding payments and supports explicitly switching them off", () => {
    const inflows = snapshotInflows(snapshotSchema.parse({ ...snapshot, payments: [{ ...payment, expectedDate: "2026-10-01" }] }));
    expect(projectExpectedInflows(inflows, now, 30)[0].date).toBe("2026-10-10");
    expect(projectExpectedInflows(inflows, now, 30, { "brookos:milestone-1": "" })).toEqual([]);
  });
  it("feeds the actual game-plan engine once, without modifying opening cash", () => {
    const base: BuildLinesArgs = { now, horizonDays: 30, startLiquid: 1000, cycleLength: 30,
      incomeTxns: [], incomeFallback: null, actualCaps: [], budgetCaps: [], committed: [],
      toggles: {}, inflows: snapshotInflows(snapshotSchema.parse(snapshot)), receivables: 0, creditHeadroom: 0 };
    const result = buildLines(base);
    expect(result.startLiquid).toBe(1000);
    expect(result.events.filter((e) => e.label === "Expected: Client milestone")).toHaveLength(1);
    expect(result.lines[0].series.at(-1)?.balance).toBe(3400);
  });
  it("rejects duplicates, foreign currencies, invalid dates, overpayment, and injected household ids", () => {
    for (const payments of [[payment, payment], [{ ...payment, currency: "USD" }],
      [{ ...payment, expectedDate: "2026-02-30" }], [{ ...payment, receivedAmount: 6000 }]]) {
      expect(snapshotSchema.safeParse({ ...snapshot, payments }).success).toBe(false);
    }
    expect(snapshotSchema.safeParse({ ...snapshot, householdId: "another-household" }).success).toBe(false);
  });
});
