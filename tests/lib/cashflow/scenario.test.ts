import { describe, it, expect } from "vitest";
import { lineZero, weeksToZero, creditZero, weeksToCredit } from "@/lib/cashflow/scenario";

describe("lineZero", () => {
  it("returns the first date the balance ≤ 0", () => {
    const series = [
      { date: "2026-06-14", balance: 1000 },
      { date: "2026-06-21", balance: 400 },
      { date: "2026-06-28", balance: -50 },
    ];
    expect(lineZero(series)).toBe("2026-06-28");
  });
  it("returns null when never crossing zero (covered)", () => {
    const series = [
      { date: "2026-06-14", balance: 1000 },
      { date: "2026-06-21", balance: 1200 },
    ];
    expect(lineZero(series)).toBeNull();
  });
});

describe("weeksToZero", () => {
  it("counts whole weeks from the first point to the zero date", () => {
    const series = [
      { date: "2026-06-14", balance: 1000 },
      { date: "2026-06-28", balance: 0 },
    ];
    expect(weeksToZero(series)).toBe(2);
  });
  it("null when covered", () => {
    expect(weeksToZero([{ date: "2026-06-14", balance: 5 }])).toBeNull();
  });
});

describe("creditZero", () => {
  const series = [
    { date: "2026-06-15", balance: 800 },
    { date: "2026-06-22", balance: -400 },
    { date: "2026-06-29", balance: -1200 },
  ];
  it("returns first date balance <= -headroom", () => {
    expect(creditZero(series, 1000)).toBe("2026-06-29");
  });
  it("equals the cash-zero date when headroom is 0", () => {
    expect(creditZero(series, 0)).toBe("2026-06-22");
  });
  it("null when credit never exhausted", () => {
    expect(creditZero(series, 100000)).toBeNull();
  });
});

describe("weeksToCredit", () => {
  it("whole weeks from start to creditZero", () => {
    const s = [{ date: "2026-06-15", balance: 0 }, { date: "2026-06-29", balance: -1000 }];
    expect(weeksToCredit(s, 1000)).toBe(2);
  });
  it("null when never exhausted", () => {
    expect(weeksToCredit([{ date: "2026-06-15", balance: -10 }], 1000)).toBeNull();
  });
});
