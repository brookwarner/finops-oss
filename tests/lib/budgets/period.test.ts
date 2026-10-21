import { describe, it, expect } from "vitest";
import { defaultPeriod, daysBetween, periodProgress, toISODate } from "@/lib/budgets/period";

// Assert on UTC date components — defaultPeriod builds UTC-midnight boundaries
// (matching forecast/mortgage which use Date.UTC / getUTC* exclusively).
// utcYmd() mirrors toISODate's getUTC* serialisation, making assertions TZ-stable
// across local dev (any TZ), Vercel (UTC), and browser environments.
function utcYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

describe("toISODate", () => {
  it("serialises a UTC-midnight cycle boundary as the same calendar day (TZ-stable)", () => {
    // defaultPeriod builds UTC-midnight dates; toISODate must read UTC components
    // so the calendar day is stable in any timezone (e.g. NZST +12 would shift a
    // local-component read back one day: writing 05-19 for the 20th cycle).
    const d = new Date(Date.UTC(2026, 4, 20)); // UTC midnight, 20 May 2026
    expect(toISODate(d)).toBe("2026-05-20");
    const p = defaultPeriod(new Date("2026-06-05T10:00:00Z"));
    expect(toISODate(p.start)).toBe("2026-05-20");
    expect(toISODate(p.end)).toBe("2026-06-20");
  });
});

describe("defaultPeriod", () => {
  it("starts on the 20th of the current month when day >= 20", () => {
    const p = defaultPeriod(new Date("2026-06-25T10:00:00Z"));
    expect(utcYmd(p.start)).toBe("2026-06-20");
    expect(utcYmd(p.end)).toBe("2026-07-20");
  });
  it("starts on the 20th of the previous month when day < 20", () => {
    const p = defaultPeriod(new Date("2026-06-05T10:00:00Z"));
    expect(utcYmd(p.start)).toBe("2026-05-20");
    expect(utcYmd(p.end)).toBe("2026-06-20");
  });
});

describe("periodProgress", () => {
  it("computes day-of-period, length and days left", () => {
    const start = new Date("2026-06-20T00:00:00Z");
    const end = new Date("2026-07-20T00:00:00Z");
    const r = periodProgress(start, end, new Date("2026-06-25T00:00:00Z"));
    expect(r.periodLength).toBe(30);
    expect(r.dayOfPeriod).toBe(6);
    expect(r.daysLeft).toBe(24);
  });
});

describe("daysBetween", () => {
  it("is non-negative whole days", () => {
    expect(daysBetween(new Date("2026-06-20"), new Date("2026-06-25"))).toBe(5);
    expect(daysBetween(new Date("2026-06-25"), new Date("2026-06-20"))).toBe(0);
  });
});
