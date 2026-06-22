import { describe, it, expect } from "vitest";
import { normaliseMerchant, detectSubscriptions, type DetectTxn } from "./detect";

describe("normaliseMerchant", () => {
  it("lowercases and keeps alphabetic tokens", () => {
    expect(normaliseMerchant("Spotify  NZ", null)).toBe("spotify nz");
  });
  it("strips trailing reference/order tokens so variants cluster", () => {
    expect(normaliseMerchant("ADAPT 4823", null)).toBe("adapt");
    expect(normaliseMerchant("ADAPT 4901", null)).toBe("adapt");
    expect(normaliseMerchant("NETFLIX #INV-2026-05", null)).toBe("netflix");
  });
  it("drops varying alphanumeric reference codes so a sub clusters into one key", () => {
    expect(normaliseMerchant("Spotify P32A0291C", null)).toBe("spotify");
    expect(normaliseMerchant("Spotify P33800535", null)).toBe("spotify");
    expect(normaliseMerchant("Disney Plus 19 524651", null)).toBe("disney plus");
  });
  it("strips leading digits glued to a word", () => {
    expect(normaliseMerchant("707-652-3328ADAPT", null)).toBe("adapt");
    expect(normaliseMerchant("9260NCHENZ Warner", null)).toBe("nchenz warner");
  });
  it("falls back to description when merchant is empty", () => {
    expect(normaliseMerchant(null, "GOOGLE *YouTubePremium")).toBe("google youtubepremium");
    expect(normaliseMerchant("", "Disney Plus")).toBe("disney plus");
  });
  it("returns empty string when both are empty", () => {
    expect(normaliseMerchant(null, null)).toBe("");
  });
});

// Helper: a monthly charge series. `n` charges, ~1 month apart, from `start`.
function monthly(merchant: string, amounts: number[], startISO: string): DetectTxn[] {
  const start = new Date(startISO);
  return amounts.map((amt, i) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + i);
    return {
      id: `${merchant}-${i}`,
      occurred_at: d.toISOString(),
      amount: -Math.abs(amt),
      merchant,
      description: null,
      category_id: "cat-subs",
      categoryKind: "monthly_cap",
    };
  });
}

const NOW = new Date("2026-06-05T00:00:00Z");

describe("detectSubscriptions — qualification", () => {
  it("detects a clean monthly subscription", () => {
    const txns = monthly("Spotify", [33.99, 33.99, 33.99, 33.99, 33.99, 33.99], "2026-01-04");
    const { subscriptions } = detectSubscriptions(txns, NOW);
    expect(subscriptions).toHaveLength(1);
    const s = subscriptions[0];
    expect(s.merchantKey).toBe("spotify");
    expect(s.cadence).toBe("monthly");
    expect(s.amount).toBe(33.99);
    expect(s.occurrences).toBe(6);
    expect(s.status).toBe("active");
  });

  it("does not qualify fewer than 3 occurrences", () => {
    const txns = monthly("Rarely", [10, 10], "2026-04-01");
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });

  it("does not qualify irregular intervals", () => {
    const txns: DetectTxn[] = [
      { id: "a", occurred_at: "2026-01-02T00:00:00Z", amount: -12, merchant: "Random", description: null, category_id: "c", categoryKind: "monthly_cap" },
      { id: "b", occurred_at: "2026-01-09T00:00:00Z", amount: -80, merchant: "Random", description: null, category_id: "c", categoryKind: "monthly_cap" },
      { id: "c", occurred_at: "2026-03-20T00:00:00Z", amount: -5, merchant: "Random", description: null, category_id: "c", categoryKind: "monthly_cap" },
    ];
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });

  it("marks a lapsed subscription when last charge is old (within 3 cycles)", () => {
    // monthly("OldSub",...,"2026-01-06"): charges 2026-01-06, 2026-02-06, 2026-03-06, 2026-04-06
    // last charge 2026-04-06 → age from 2026-06-05 = 60 days = 2 monthly cycles → lapsed (>1.5×) but under 3× drop horizon
    const txns = monthly("OldSub", [9, 9, 9, 9], "2026-01-06");
    const { subscriptions } = detectSubscriptions(txns, NOW);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].status).toBe("lapsed");
  });

  it("surfaces a sub lapsed ~2 cycles ago (shown, dimmed)", () => {
    // charges 2026-01-06, 2026-02-06, 2026-03-06, 2026-04-06
    // last charge 2026-04-06 → age from 2026-06-05 = 60 days ≈ 2 monthly cycles
    // 60 ≤ 90 (3 × 30) → shown as lapsed
    const txns = monthly("TwoCyclesAgo", [9, 9, 9, 9], "2026-01-06");
    const subs = detectSubscriptions(txns, NOW).subscriptions;
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("lapsed");
  });

  it("drops a sub whose last charge is beyond 3 cycles", () => {
    // charges 2025-11-05, 2025-12-05, 2026-01-05, 2026-02-05
    // last charge 2026-02-05 → age from 2026-06-05 = 120 days ≈ 4 monthly cycles
    // 120 > 90 (3 × 30) → dropped entirely
    const txns = monthly("LongDead", [9, 9, 9, 9], "2025-11-05");
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });

  it("captures amount range for price changes", () => {
    const txns = monthly("Stepped", [10, 10, 13, 13], "2026-02-01");
    const s = detectSubscriptions(txns, NOW).subscriptions[0];
    expect(s.amountMin).toBe(10);
    expect(s.amountMax).toBe(13);
  });

  it("excludes transfers and income", () => {
    const txns = monthly("Payday", [2300, 2300, 2300], "2026-03-01").map((t) => ({
      ...t, amount: Math.abs(t.amount), categoryKind: "income",
    }));
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });

  it("excludes by categoryKind alone (negative amount, excluded kind)", () => {
    const txns = monthly("Wages", [2300, 2300, 2300], "2026-03-01").map((t) => ({
      ...t, categoryKind: "transfer",
    }));
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });

  it("rejects a too-variable merchant (not a fixed-price subscription)", () => {
    const txns = monthly("PayPal", [1, 161, 30, 12, 90], "2026-01-04");
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });
  it("accepts a near-fixed-price sub within the ratio", () => {
    const txns = monthly("OneNZPrepayLike", [10, 22, 19, 20], "2026-01-04"); // ratio 2.2 < 3
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(1);
  });

  it("classifies monthly cadence despite FX-drifting amounts", () => {
    const txns = monthly("ADAPT", [85.91, 86.40, 87.10, 85.50, 86.88, 87.57], "2026-01-04");
    const { subscriptions } = detectSubscriptions(txns, NOW);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].cadence).toBe("monthly");
  });

  it("uses calendar months for nextExpected", () => {
    const txns = monthly("Cal", [5, 5, 5], "2026-03-15");
    const s = detectSubscriptions(txns, NOW).subscriptions[0];
    expect(s.nextExpected).toBe("2026-06-15");
  });
});

describe("detectSubscriptions — duplicates", () => {
  it("flags a double-charge within one cadence window", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-04T00:00:00Z");
    for (let m = 0; m < 5; m++) {
      const d1 = new Date(base); d1.setMonth(d1.getMonth() + m);
      const d2 = new Date(d1); d2.setDate(d2.getDate() + 3);
      txns.push({ id: `a-${m}`, occurred_at: d1.toISOString(), amount: -85.91, merchant: "ADAPT", description: null, category_id: "c", categoryKind: "monthly_cap" });
      txns.push({ id: `b-${m}`, occurred_at: d2.toISOString(), amount: -86.40, merchant: "ADAPT", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const { subscriptions, duplicates } = detectSubscriptions(txns, new Date("2026-06-05T00:00:00Z"));
    expect(subscriptions).toHaveLength(1);
    expect(duplicates).toHaveLength(5);
    expect(duplicates[0].merchantKey).toBe("adapt");
    expect(duplicates[0].amount).toBeGreaterThan(0);
    expect(duplicates[0].txnIds.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag a normal single monthly charge", () => {
    const txns = monthly("Clean", [10, 10, 10, 10], "2026-02-01");
    expect(detectSubscriptions(txns, new Date("2026-06-05T00:00:00Z")).duplicates).toHaveLength(0);
  });
});

describe("detectSubscriptions — exclusions", () => {
  it("excludes uncategorised transactions", () => {
    const txns = monthly("Netflix", [19, 19, 19], "2026-03-01").map((t) => ({
      ...t, category_id: null,
    }));
    expect(detectSubscriptions(txns, NOW).subscriptions).toHaveLength(0);
  });
});

describe("detectSubscriptions — brand+amount cluster merge", () => {
  // Same brand, same price, different trailing tokens → must merge into ONE sub.
  it("merges merchant-string variants of the same sub (Disney / Disney Plus)", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-21T00:00:00Z");
    // 4 "Disney Plus 19 524651" charges, then a recent lone "Disney"
    for (let m = 0; m < 4; m++) {
      const d = new Date(base); d.setMonth(d.getMonth() + m);
      txns.push({ id: `dp-${m}`, occurred_at: d.toISOString(), amount: -16.99, merchant: "Disney Plus 19 524651 2685", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const recent = new Date(base); recent.setMonth(recent.getMonth() + 4);
    txns.push({ id: "d-recent", occurred_at: recent.toISOString(), amount: -16.99, merchant: "Disney", description: null, category_id: "c", categoryKind: "monthly_cap" });

    const { subscriptions } = detectSubscriptions(txns, new Date("2026-06-06T00:00:00Z"));
    expect(subscriptions).toHaveLength(1);
    // occurrences include the recent lone charge, and lastSeen reflects it
    expect(subscriptions[0].occurrences).toBe(5);
    expect(subscriptions[0].lastSeen).toBe(recent.toISOString().slice(0, 10));
    expect(subscriptions[0].status).toBe("active");
  });

  // Same brand, DIFFERENT price points → must stay SEPARATE subs.
  it("keeps same-brand different-price subs separate (Google One vs Google AllTrails)", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-10T00:00:00Z");
    for (let m = 0; m < 4; m++) {
      const d = new Date(base); d.setMonth(d.getMonth() + m);
      txns.push({ id: `g1-${m}`, occurred_at: d.toISOString(), amount: -16.99, merchant: "Google One 27 2685", description: null, category_id: "c", categoryKind: "monthly_cap" });
      txns.push({ id: `ga-${m}`, occurred_at: d.toISOString(), amount: -4.49, merchant: "Google AllTrails 2 2685", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const { subscriptions } = detectSubscriptions(txns, new Date("2026-06-06T00:00:00Z"));
    expect(subscriptions).toHaveLength(2);
    const amounts = subscriptions.map((s) => s.amount).sort((a, b) => a - b);
    expect(amounts).toEqual([4.49, 16.99]);
  });

  // Different brands at the SAME price → never merge (brand gate).
  it("never merges across brands even at the same price", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-05T00:00:00Z");
    for (let m = 0; m < 4; m++) {
      const d = new Date(base); d.setMonth(d.getMonth() + m);
      txns.push({ id: `dis-${m}`, occurred_at: d.toISOString(), amount: -16.99, merchant: "Disney Plus", description: null, category_id: "c", categoryKind: "monthly_cap" });
      txns.push({ id: `goo-${m}`, occurred_at: d.toISOString(), amount: -16.99, merchant: "Google One", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const { subscriptions } = detectSubscriptions(txns, new Date("2026-06-06T00:00:00Z"));
    expect(subscriptions).toHaveLength(2);
  });

  // Regression: two same-brand anchors at overlapping prices must STAY SEPARATE.
  it("does not blob multiple same-brand subscriptions into one (Kindle Unlimited vs Kindle book buys)", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-13T00:00:00Z");
    // Kindle Unlimited: clean monthly ~$16
    for (let m = 0; m < 5; m++) {
      const d = new Date(base); d.setMonth(d.getMonth() + m);
      txns.push({ id: `ku-${m}`, occurred_at: d.toISOString(), amount: -16.0, merchant: "Kindle Unltd 12 524651 AUD", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    // Kindle book buys: also monthly-ish, ~$11 (distinct price → stays separate)
    for (let m = 0; m < 4; m++) {
      const d = new Date(base); d.setMonth(d.getMonth() + m); d.setDate(20);
      txns.push({ id: `ks-${m}`, occurred_at: d.toISOString(), amount: -11.0, merchant: "Kindle Svcs 20 524651 AUD", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const subs = detectSubscriptions(txns, new Date("2026-06-06T00:00:00Z"));
    // two distinct anchors, different price → NOT blobbed into one
    expect(subs.subscriptions.length).toBe(2);
    const amts = subs.subscriptions.map((s) => s.amount).sort((a, b) => a - b);
    expect(amts).toEqual([11, 16]);
  });

  // An orphan fragment with no matching anchor must not be force-merged and simply fails qualification.
  it("leaves an orphan fragment alone (no anchor to absorb into)", () => {
    const txns: DetectTxn[] = [
      { id: "x", occurred_at: "2026-05-01T00:00:00Z", amount: -9.99, merchant: "Obscure", description: null, category_id: "c", categoryKind: "monthly_cap" },
    ];
    expect(detectSubscriptions(txns, new Date("2026-06-06T00:00:00Z")).subscriptions).toHaveLength(0);
  });
});

describe("detectSubscriptions — display name", () => {
  it("derives a clean brand name, dropping reference codes and amounts", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-04T00:00:00Z");
    const descs = [
      "Joytunes 02 524651 2685 USD 24.90",
      "Joytunes 02 999111 2685 USD 24.90",
      "Joytunes 06 123456 2685 USD 24.90",
      "Joytunes 09 222333 2685 USD 24.90",
    ];
    descs.forEach((d, i) => {
      const dt = new Date(base); dt.setMonth(dt.getMonth() + i);
      txns.push({ id: `j-${i}`, occurred_at: dt.toISOString(), amount: -24.90, merchant: d, description: null, category_id: "c", categoryKind: "monthly_cap" });
    });
    const { subscriptions } = detectSubscriptions(txns, new Date("2026-06-05T00:00:00Z"));
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].displayName).toBe("Joytunes");
  });

  it("falls back to a title-cased key when the raw name leads with a code", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-01-04T00:00:00Z");
    for (let i = 0; i < 4; i++) {
      const dt = new Date(base); dt.setMonth(dt.getMonth() + i);
      txns.push({ id: `a-${i}`, occurred_at: dt.toISOString(), amount: -86, merchant: "707-652-3328ADAPT", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const s = detectSubscriptions(txns, new Date("2026-06-05T00:00:00Z")).subscriptions[0];
    expect(s.merchantKey).toBe("adapt");
    expect(s.displayName).toBe("Adapt");
  });
});
