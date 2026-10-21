import { describe, it, expect } from "vitest";
import { derivePostings, BILL_STALE_DAYS } from "@/lib/forecast/postings";

const NOW = new Date("2026-08-29T00:00:00Z");
const txn = (occurred_at: string, amount: number, merchant?: string) => ({
  occurred_at, amount, merchant: merchant ?? null, description: null,
});

describe("derivePostings", () => {
  it("returns nothing when there is no recent outflow", () => {
    expect(derivePostings([], NOW)).toEqual([]);
  });

  it("seeds a single monthly bill from its latest posting", () => {
    const postings = derivePostings(
      [txn("2026-08-20T00:00:00Z", -300, "Meridian Energy"), txn("2026-07-20T00:00:00Z", -280, "Meridian Energy")],
      NOW,
    );
    expect(postings).toEqual([{ day: 20, amount: 300 }]);
  });

  it("totals every direct debit a category pays on the same day", () => {
    // The bug this fixes: "Insurance" is five debits on the 20th. Seeding only the
    // most recent one (Sovereign, $5) reported a $562.66 bill as $5.
    const postings = derivePostings(
      [
        txn("2026-08-20T01:00:00Z", -272.66, "FidelityLife"),
        txn("2026-08-20T02:00:00Z", -150, "AA INSURANCE LIMITED"),
        txn("2026-08-20T03:00:00Z", -90, "AA INSURANCE LIMITED 2"),
        txn("2026-08-20T04:00:00Z", -45, "Sovereign"),
        txn("2026-08-20T05:00:00Z", -5, "Sovereign Life"),
      ],
      NOW,
    );
    expect(postings).toEqual([{ day: 20, amount: 562.66 }]);
  });

  it("keeps debits on different days as separate dated events", () => {
    const postings = derivePostings(
      [txn("2026-08-24T00:00:00Z", -18, "Spark"), txn("2026-08-20T00:00:00Z", -100, "One NZ Fibre")],
      NOW,
    );
    expect(postings).toEqual([{ day: 20, amount: 100 }, { day: 24, amount: 18 }]);
  });

  it("counts one cycle only, even when two months of the same bill are in range", () => {
    const postings = derivePostings(
      [
        txn("2026-08-20T00:00:00Z", -300, "Meridian Energy"),
        txn("2026-07-20T00:00:00Z", -300, "Meridian Energy"),
        txn("2026-06-20T00:00:00Z", -300, "Meridian Energy"),
      ],
      NOW,
    );
    expect(postings).toEqual([{ day: 20, amount: 300 }]);
  });

  it("does not double-count a bill whose post-date drifts month to month", () => {
    // 1 Aug and 2 Jul are the same bill, ~30d apart — one cycle, not two.
    const postings = derivePostings(
      [txn("2026-08-01T00:00:00Z", -120, "One NZ"), txn("2026-07-02T00:00:00Z", -120, "One NZ")],
      NOW,
    );
    expect(postings).toEqual([{ day: 1, amount: 120 }]);
  });

  it("keeps both charges of a sub-monthly (fortnightly) bill", () => {
    const postings = derivePostings(
      [txn("2026-08-26T00:00:00Z", -60, "Kindy"), txn("2026-08-12T00:00:00Z", -60, "Kindy")],
      NOW,
    );
    expect(postings).toEqual([{ day: 12, amount: 60 }, { day: 26, amount: 60 }]);
  });

  it("drops a merchant that has not billed this cycle (lapsed or annual)", () => {
    const stale = new Date(NOW.getTime() - (BILL_STALE_DAYS + 5) * 86_400_000).toISOString();
    const postings = derivePostings(
      [txn("2026-08-20T00:00:00Z", -300, "Meridian Energy"), txn(stale, -900, "Annual Premium")],
      NOW,
    );
    expect(postings).toEqual([{ day: 20, amount: 300 }]);
  });

  it("ignores refunds and inflows", () => {
    const postings = derivePostings(
      [txn("2026-08-20T00:00:00Z", -300, "Meridian Energy"), txn("2026-08-21T00:00:00Z", 50, "Meridian Energy")],
      NOW,
    );
    expect(postings).toEqual([{ day: 20, amount: 300 }]);
  });

  it("falls back to day-of-month grouping when rows carry no merchant text", () => {
    const postings = derivePostings(
      [
        { occurred_at: "2026-08-25T00:00:00Z", amount: -80 },
        { occurred_at: "2026-08-01T00:00:00Z", amount: -40 },
        { occurred_at: "2026-07-25T00:00:00Z", amount: -80 },
        { occurred_at: "2026-07-01T00:00:00Z", amount: -40 },
      ],
      NOW,
    );
    // Without a merchant key the day-of-month keeps the two bills apart, so the
    // 1st isn't swallowed by the 25th's cycle boundary.
    expect(postings).toEqual([{ day: 1, amount: 40 }, { day: 25, amount: 80 }]);
  });
});
