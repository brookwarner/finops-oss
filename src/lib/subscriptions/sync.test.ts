import { describe, it, expect } from "vitest";
import { buildSyncPlan, type ExistingSub } from "./sync";
import { detectSubscriptions, type DetectTxn } from "./detect";

function monthly(merchant: string, amts: number[], startISO: string): DetectTxn[] {
  const start = new Date(startISO);
  return amts.map((a, i) => {
    const d = new Date(start); d.setMonth(d.getMonth() + i);
    return { id: `${merchant}-${i}`, occurred_at: d.toISOString(), amount: -a, merchant, description: null, category_id: "c", categoryKind: "monthly_cap" };
  });
}

const NOW = new Date("2026-06-05T00:00:00Z");

// Note: the SUBSCRIPTION_CATEGORIES input filter lives in the I/O wrapper
// syncSubscriptions (not buildSyncPlan), so it is covered by the read-only
// integration check rather than a brittle Supabase-mock unit test here.

describe("buildSyncPlan", () => {
  it("removes subs absent from this run (stale beyond drop horizon)", () => {
    const det = detectSubscriptions(monthly("Spotify", [34, 34, 34, 34], "2026-02-01"), NOW);
    const existing: ExistingSub[] = [
      { id: "s1", merchant_key: "spotify", last_duplicate_window: null },
      { id: "s2", merchant_key: "deadsub", last_duplicate_window: null },
    ];
    const plan = buildSyncPlan("hh", det, existing, {});
    expect(plan.removedKeys).toContain("deadsub");
  });

  it("carries forward a duplicate window only when newer than recorded", () => {
    const txns: DetectTxn[] = [];
    const base = new Date("2026-03-04T00:00:00Z");
    for (let m = 0; m < 3; m++) {
      const d1 = new Date(base); d1.setMonth(d1.getMonth() + m);
      const d2 = new Date(d1); d2.setDate(d2.getDate() + 2);
      txns.push({ id: `a${m}`, occurred_at: d1.toISOString(), amount: -86, merchant: "ADAPT", description: null, category_id: "c", categoryKind: "monthly_cap" });
      txns.push({ id: `b${m}`, occurred_at: d2.toISOString(), amount: -86, merchant: "ADAPT", description: null, category_id: "c", categoryKind: "monthly_cap" });
    }
    const det = detectSubscriptions(txns, NOW);
    const plan = buildSyncPlan("hh", det, [], {});
    const up = plan.upserts.find((u) => u.merchant_key === "adapt")!;
    expect(up.last_duplicate_window).not.toBeNull();
  });
});
