import { describe, it, expect } from "vitest";
import { mapInflows, defaultLandDate, expectedInflowByCycleEnd, inflowNet, type Inflow } from "@/lib/cashflow/inflows";

const NOW = new Date("2026-06-14T00:00:00Z");

describe("mapInflows", () => {
  it("maps receivable accounts (with terms) to Inflows; clamps amount >= 0", () => {
    const rows = [
      { akahu_account_id: "manual_tax", name: "Tax refund", type: "receivable", balance_current: 1200,
        expected_inflows: [{ likelihood: "likely", expected_date: "2026-07-01", pre_tax: false, tax_rate: 0 }] },
      { akahu_account_id: "manual_bonus", name: "Bonus", type: "receivable", balance_current: 5000,
        expected_inflows: [{ likelihood: "uncertain", expected_date: null, pre_tax: true, tax_rate: 0.39 }] },
      { akahu_account_id: "manual_neg", name: "Bad", type: "receivable", balance_current: -10, expected_inflows: [] },
      { akahu_account_id: "acc_x", name: "Everyday", type: "checking", balance_current: 999, expected_inflows: [] },
    ];
    const out = mapInflows(rows);
    expect(out.map((i) => i.id)).toEqual(["manual_tax", "manual_bonus", "manual_neg"]);
    expect(out[0]).toEqual({ id: "manual_tax", label: "Tax refund", amount: 1200, likelihood: "likely", expectedDate: "2026-07-01", taxRate: 0 });
    expect(out[1].taxRate).toBe(0.39); // pre_tax → rate applied
    expect(out[2]).toEqual({ id: "manual_neg", label: "Bad", amount: 0, likelihood: "likely", expectedDate: null, taxRate: 0 });
  });
  it("defaults missing terms to likely/no-date/0 and ignores tax_rate when not pre_tax", () => {
    const out = mapInflows([
      { akahu_account_id: "manual_a", name: "A", type: "receivable", balance_current: 100,
        expected_inflows: [{ likelihood: "likely", expected_date: null, pre_tax: false, tax_rate: 0.39 }] },
    ]);
    expect(out[0].taxRate).toBe(0); // not pre_tax → rate ignored
  });
  it("handles a receivable whose embedded terms are null (no row yet)", () => {
    const out = mapInflows([
      { akahu_account_id: "manual_b", name: "B", type: "receivable", balance_current: 250, expected_inflows: null },
    ]);
    expect(out[0]).toEqual({ id: "manual_b", label: "B", amount: 250, likelihood: "likely", expectedDate: null, taxRate: 0 });
  });
  it("reads terms when PostgREST embeds the to-one relation as an OBJECT (not an array)", () => {
    // Verified against prod: a unique-FK to-one embed returns a single object.
    const out = mapInflows([
      { akahu_account_id: "manual_c", name: "C", type: "receivable", balance_current: 5000,
        expected_inflows: { likelihood: "uncertain", expected_date: "2026-09-01", pre_tax: true, tax_rate: 0.39 } as any },
    ]);
    expect(out[0]).toEqual({ id: "manual_c", label: "C", amount: 5000, likelihood: "uncertain", expectedDate: "2026-09-01", taxRate: 0.39 });
  });
});

describe("defaultLandDate", () => {
  const base: Inflow = { id: "x", label: "X", amount: 1, likelihood: "likely", expectedDate: null, taxRate: 0 };
  it("uses expectedDate when set", () => {
    expect(defaultLandDate({ ...base, expectedDate: "2026-08-09" }, NOW)).toBe("2026-08-09");
  });
  it("offsets by likelihood when no date: likely +28d, uncertain +84d", () => {
    expect(defaultLandDate(base, NOW)).toBe("2026-07-12");
    expect(defaultLandDate({ ...base, likelihood: "uncertain" }, NOW)).toBe("2026-09-06");
  });
});

describe("expectedInflowByCycleEnd", () => {
  // Cycle ends 2026-07-20; "now" is 2026-06-14.
  const cycleEnd = new Date("2026-07-20T00:00:00Z");
  const mk = (over: Partial<Inflow>): Inflow => ({
    id: "x", label: "X", amount: 1000, likelihood: "likely", expectedDate: null, taxRate: 0, ...over,
  });

  it("sums net amounts of likely inflows landing on/before cycle end", () => {
    const inflows = [
      mk({ id: "a", amount: 8000, expectedDate: "2026-07-01" }), // in-cycle
      mk({ id: "b", amount: 2000, expectedDate: "2026-07-20" }), // boundary — included
    ];
    expect(expectedInflowByCycleEnd(inflows, cycleEnd, new Date("2026-06-14T00:00:00Z"))).toBe(10000);
  });

  it("excludes inflows expected after cycle end", () => {
    const inflows = [mk({ amount: 5000, expectedDate: "2026-08-01" })];
    expect(expectedInflowByCycleEnd(inflows, cycleEnd, new Date("2026-06-14T00:00:00Z"))).toBe(0);
  });

  it("excludes uncertain inflows by default, includes them when asked", () => {
    const inflows = [mk({ amount: 4000, likelihood: "uncertain", expectedDate: "2026-07-01" })];
    const now = new Date("2026-06-14T00:00:00Z");
    expect(expectedInflowByCycleEnd(inflows, cycleEnd, now)).toBe(0);
    expect(expectedInflowByCycleEnd(inflows, cycleEnd, now, { includeUncertain: true })).toBe(4000);
  });

  it("applies the tax rate to the net contribution", () => {
    const inflows = [mk({ amount: 10000, taxRate: 0.39, expectedDate: "2026-07-01" })];
    expect(expectedInflowByCycleEnd(inflows, cycleEnd, new Date("2026-06-14T00:00:00Z"))).toBe(6100);
  });

  it("counts an overdue-but-outstanding receivable (date already passed)", () => {
    // Expected 2026-06-01 (before now) but still on the books → still owed, counts.
    const inflows = [mk({ amount: 3000, expectedDate: "2026-06-01" })];
    expect(expectedInflowByCycleEnd(inflows, cycleEnd, new Date("2026-06-14T00:00:00Z"))).toBe(3000);
  });

  it("uses the likelihood offset when no explicit date is set", () => {
    // likely + no date → now+28d = 2026-07-12, which is before cycleEnd → counts.
    const early = new Date("2026-06-14T00:00:00Z");
    expect(expectedInflowByCycleEnd([mk({ amount: 1000 })], cycleEnd, early)).toBe(1000);
    // If now is late in the cycle, now+28d lands after cycleEnd → excluded.
    const late = new Date("2026-07-10T00:00:00Z");
    expect(expectedInflowByCycleEnd([mk({ amount: 1000 })], cycleEnd, late)).toBe(0);
  });

  it("inflowNet applies tax and rounds to cents", () => {
    expect(inflowNet({ id: "a", label: "A", amount: 100, likelihood: "likely", expectedDate: null, taxRate: 0.105 })).toBe(89.5);
  });
});
