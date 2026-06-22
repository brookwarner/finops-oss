import { describe, it, expect } from "vitest";
import { buildLines, type BuildLinesArgs } from "@/lib/cashflow/compute";

const NOW = new Date("2026-06-14T00:00:00Z");

const args: BuildLinesArgs = {
  now: NOW,
  horizonDays: 400,
  startLiquid: 7000,
  cycleLength: 30,
  incomeTxns: [],
  incomeFallback: null,
  actualCaps: [
    { categoryId: "groceries", dailyActual: 50, spendClass: "essential" },
    { categoryId: "dining", dailyActual: 50, spendClass: "discretionary" },
  ],
  budgetCaps: [{ categoryId: "all", monthlyTarget: 70 * 30, spendClass: "essential" }],
  committed: [
    { categoryId: "Power", kind: "ap_amortised", monthlyTarget: 1000, lastActualDay: 21, lastActualAmount: 1000, spendClass: "essential" },
    { categoryId: "Donations", kind: "ap_amortised", monthlyTarget: 200, lastActualDay: 22, lastActualAmount: 200, spendClass: "discretionary" },
  ],
  toggles: {},
  inflows: [{ id: "manual_x", label: "Secured", amount: 5000, likelihood: "likely", expectedDate: null, taxRate: 0 }],
  receivables: 10000,
  creditHeadroom: 3000,
};

describe("buildLines", () => {
  it("produces the four named lines", () => {
    const { lines } = buildLines(args);
    expect(lines.map((l) => l.key)).toEqual(["actual", "onBudget", "bareEssentials", "custom"]);
  });
  it("bare-essentials outlasts actual pace when discretionary > 0", () => {
    const { lines } = buildLines(args);
    const actual = lines.find((l) => l.key === "actual")!;
    const bare = lines.find((l) => l.key === "bareEssentials")!;
    expect(actual.cashZeroDate).not.toBeNull();
    expect(bare.cashZeroDate).not.toBeNull();
    expect(bare.cashZeroDate! > actual.cashZeroDate!).toBe(true);
  });
  it("a dated inflow pushes the credit-zero date later", () => {
    const cz = (r: ReturnType<typeof buildLines>, k: string) => r.lines.find((l) => l.key === k)!.creditZeroDate!;
    expect(cz(buildLines({ ...args, toggles: { lumps: { manual_x: "2026-07-15" } } }), "actual") > cz(buildLines(args), "actual")).toBe(true);
  });
  it("a dated inflow lands as a step-up on its date, not at the start", () => {
    const landed = buildLines({ ...args, toggles: { lumps: { manual_x: "2026-07-15" } } });
    const base = buildLines(args);
    const sL = landed.lines.find((l) => l.key === "actual")!.series;
    const sB = base.lines.find((l) => l.key === "actual")!.series;
    expect(sL[0].balance).toBe(sB[0].balance); // NOT folded into start
    const on = (s: typeof sL) => s.find((p) => p.date === "2026-07-15")!.balance;
    expect(on(sL) - on(sB)).toBeGreaterThan(4000); // ~inflow amount lands on the date
  });
  it("no lumps toggle ⇒ no inflow effect on start", () => {
    const a = buildLines(args).lines.find((l) => l.key === "actual")!.series[0].balance;
    const b = buildLines({ ...args, toggles: {} }).lines.find((l) => l.key === "actual")!.series[0].balance;
    expect(a).toBe(b);
  });
  it("result exposes inflows", () => {
    expect(buildLines(args).inflows).toEqual([{ id: "manual_x", label: "Secured", amount: 5000, likelihood: "likely", expectedDate: null, taxRate: 0 }]);
  });
  it("nets a landing inflow by its taxRate", () => {
    const land = "2026-07-15";
    const gross = buildLines({ ...args, inflows: [{ id: "manual_x", label: "Secured", amount: 5000, likelihood: "likely", expectedDate: null, taxRate: 0 }], toggles: { lumps: { manual_x: land } } });
    const net = buildLines({ ...args, inflows: [{ id: "manual_x", label: "Secured", amount: 5000, likelihood: "likely", expectedDate: null, taxRate: 0.39 }], toggles: { lumps: { manual_x: land } } });
    const onDate = (r: ReturnType<typeof buildLines>) => {
      const s = r.lines.find((l) => l.key === "actual")!.series;
      const base = buildLines({ ...args, inflows: [{ id: "manual_x", label: "Secured", amount: 5000, likelihood: "likely", expectedDate: null, taxRate: 0 }], toggles: {} }).lines.find((l) => l.key === "actual")!.series;
      const at = (ss: typeof s) => ss.find((p) => p.date === land)!.balance;
      return at(s) - at(base);
    };
    // gross lands ~5000; net lands ~5000*0.61 = 3050
    expect(Math.round(onDate(gross))).toBe(5000);
    expect(Math.round(onDate(net))).toBe(3050);
  });
  it("custom 100% cut outlasts actual pace", () => {
    const custom = buildLines({ ...args, toggles: { customCutPct: 100 } }).lines.find((l) => l.key === "custom")!;
    const actual = buildLines(args).lines.find((l) => l.key === "actual")!;
    expect(custom.cashZeroDate! > actual.cashZeroDate!).toBe(true);
  });
  it("covered when income exceeds burn (no zero crossing)", () => {
    const covered = buildLines({
      ...args,
      incomeTxns: [
        { occurred_at: "2026-06-07", amount: 5000, description: "Salary ACME" },
        { occurred_at: "2026-06-14", amount: 5000, description: "Salary ACME" },
      ],
    });
    expect(covered.lines.find((l) => l.key === "actual")!.cashZeroDate).toBeNull();
  });
  it("each line exposes cashZeroDate and creditZeroDate, credit later than cash", () => {
    const { lines } = buildLines(args);
    const actual = lines.find((l) => l.key === "actual")!;
    expect(actual.cashZeroDate).not.toBeNull();
    expect(actual.creditZeroDate).not.toBeNull();
    expect(actual.creditZeroDate! > actual.cashZeroDate!).toBe(true);
  });
  it("result carries creditHeadroom", () => {
    expect(buildLines(args).creditHeadroom).toBe(3000);
  });
  it("cutting discretionary pushes creditZeroDate out vs actual", () => {
    const r = buildLines({ ...args, toggles: { customCutPct: 80 } });
    const actual = r.lines.find((l) => l.key === "actual")!;
    const custom = r.lines.find((l) => l.key === "custom")!;
    expect(custom.creditZeroDate! > actual.creditZeroDate!).toBe(true);
  });
  it("zero headroom => creditZeroDate equals cashZeroDate", () => {
    const r = buildLines({ ...args, creditHeadroom: 0 });
    const actual = r.lines.find((l) => l.key === "actual")!;
    expect(actual.creditZeroDate).toBe(actual.cashZeroDate);
  });
});
