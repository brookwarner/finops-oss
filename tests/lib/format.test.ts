import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatDateShort,
  formatDateFull,
  formatMonthYear,
} from "@/lib/format";

describe("formatCurrency", () => {
  it("defaults to 2dp, auto sign (negative gets a U+2212 minus, positive is bare)", () => {
    expect(formatCurrency(1240.5)).toBe("$1,240.50");
    expect(formatCurrency(-1240.5)).toBe("−$1,240.50");
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("honours the decimals option and adds thousands separators", () => {
    expect(formatCurrency(1240, { decimals: 0 })).toBe("$1,240");
    expect(formatCurrency(-1240, { decimals: 0 })).toBe("−$1,240");
    expect(formatCurrency(5, { decimals: 0 })).toBe("$5");
  });

  it('signDisplay "always" prefixes a + on non-negatives, minus on negatives', () => {
    expect(formatCurrency(50, { decimals: 0, signDisplay: "always" })).toBe("+$50");
    expect(formatCurrency(-50, { decimals: 0, signDisplay: "always" })).toBe("−$50");
    expect(formatCurrency(0, { decimals: 0, signDisplay: "always" })).toBe("+$0");
  });

  it('signDisplay "never" shows the magnitude only', () => {
    expect(formatCurrency(-50, { decimals: 0, signDisplay: "never" })).toBe("$50");
    expect(formatCurrency(50, { decimals: 0, signDisplay: "never" })).toBe("$50");
  });

  it("appends a non-NZD currency code but never NZD", () => {
    expect(formatCurrency(12, { currency: "USD" })).toBe("$12.00 USD");
    expect(formatCurrency(12, { currency: "NZD" })).toBe("$12.00");
    expect(formatCurrency(-12, { currency: "AUD", signDisplay: "always" })).toBe(
      "−$12.00 AUD",
    );
  });

  it("rounds to the requested precision", () => {
    expect(formatCurrency(1.005, { decimals: 0 })).toBe("$1");
    expect(formatCurrency(2.5, { decimals: 0 })).toBe("$3");
  });
});

describe("date formatters", () => {
  // Use a UTC-midnight instant so the calendar day is timezone-stable.
  const d = new Date("2026-06-05T00:00:00Z");

  it("formatDateShort is day + short month", () => {
    expect(formatDateShort(d)).toBe("5 Jun");
  });

  it("formatDateFull adds the year", () => {
    expect(formatDateFull(d)).toBe("5 Jun 2026");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatDateShort("2026-12-25T00:00:00Z")).toBe("25 Dec");
  });
});

describe("formatMonthYear", () => {
  it('maps "YYYY-MM" to "MMM YYYY"', () => {
    expect(formatMonthYear("2054-02")).toBe("Feb 2054");
    expect(formatMonthYear("2026-12")).toBe("Dec 2026");
  });

  it("renders an em dash for null/empty", () => {
    expect(formatMonthYear(null)).toBe("—");
    expect(formatMonthYear("")).toBe("—");
  });
});
