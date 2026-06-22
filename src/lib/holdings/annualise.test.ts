import { describe, it, expect } from "vitest";
import { annualisedReturnPct, yearsSince } from "./annualise";

const ASOF = new Date(2026, 0, 1); // 1 Jan 2026, local

describe("yearsSince", () => {
  it("measures whole years between an inception and asOf", () => {
    expect(yearsSince("2024-01-01", ASOF)).toBeCloseTo(2.0, 1);
    expect(yearsSince("2025-07-01", ASOF)).toBeCloseTo(0.5, 1);
  });
});

describe("annualisedReturnPct", () => {
  it("compounds the simple return over the holding period (CAGR)", () => {
    // 1000 -> 1200 over ~2 years: 1.2^(1/2) - 1 ≈ 9.54%/yr.
    const r = annualisedReturnPct({
      costBasis: 1000,
      returns: 200,
      inception: "2024-01-01",
      asOf: ASOF,
    });
    expect(r).toBeCloseTo(9.54, 1);
  });

  it("annualises a loss to a negative rate", () => {
    // 1000 -> 810 over ~2 years: 0.81^(1/2) - 1 = -10%/yr.
    const r = annualisedReturnPct({
      costBasis: 1000,
      returns: -190,
      inception: "2024-01-01",
      asOf: ASOF,
    });
    expect(r).toBeCloseTo(-10, 1);
  });

  it("returns null without an inception date", () => {
    expect(annualisedReturnPct({ costBasis: 1000, returns: 200, inception: null })).toBeNull();
  });

  it("returns null for a non-positive cost basis", () => {
    expect(
      annualisedReturnPct({ costBasis: 0, returns: 50, inception: "2020-01-01", asOf: ASOF }),
    ).toBeNull();
  });

  it("returns null for a total wipeout (non-positive end value)", () => {
    expect(
      annualisedReturnPct({ costBasis: 1000, returns: -1000, inception: "2020-01-01", asOf: ASOF }),
    ).toBeNull();
  });

  it("suppresses annualisation for a holding tracked under ~6 months", () => {
    // ~3 months held — annualising would turn noise into a wild rate.
    expect(
      annualisedReturnPct({ costBasis: 1000, returns: 20, inception: "2025-10-01", asOf: ASOF }),
    ).toBeNull();
  });

  it("honours a custom minimum-years floor", () => {
    const r = annualisedReturnPct({
      costBasis: 1000,
      returns: 20,
      inception: "2025-10-01",
      asOf: ASOF,
      minYears: 0.1,
    });
    expect(r).not.toBeNull();
  });
});
