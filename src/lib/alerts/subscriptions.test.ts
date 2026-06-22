import { describe, it, expect } from "vitest";
import { decideSubscriptionAlerts, type SubAlertInput } from "./subscriptions";

const base: SubAlertInput = {
  householdId: "hh",
  newSubs: [],
  duplicates: [],
  priorNewKeys: new Set(),
  priorDuplicateWindows: new Map(),
};

describe("decideSubscriptionAlerts", () => {
  it("fires subscription_new for an unseen subscription", () => {
    const events = decideSubscriptionAlerts({
      ...base,
      newSubs: [{ id: "s1", displayName: "Spotify", amount: 33.99, cadence: "monthly", nextExpected: "2026-06-22" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("subscription_new");
    expect(events[0].subscription_id).toBe("s1");
    expect(events[0].body).toMatch(/Spotify/);
  });

  it("does not re-fire subscription_new when already alerted", () => {
    const events = decideSubscriptionAlerts({
      ...base,
      newSubs: [{ id: "s1", displayName: "Spotify", amount: 33.99, cadence: "monthly", nextExpected: "2026-06-22" }],
      priorNewKeys: new Set(["s1"]),
    });
    expect(events).toHaveLength(0);
  });

  it("fires subscription_duplicate for a fresh window", () => {
    const events = decideSubscriptionAlerts({
      ...base,
      duplicates: [{ id: "s2", displayName: "ADAPT", amount: 86, cadence: "monthly", windowStart: "2026-05-04" }],
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("subscription_duplicate");
    expect(events[0].period_start).toBe("2026-05-04");
  });

  it("does not re-fire a duplicate for an already-alerted window", () => {
    const events = decideSubscriptionAlerts({
      ...base,
      duplicates: [{ id: "s2", displayName: "ADAPT", amount: 86, cadence: "monthly", windowStart: "2026-05-04" }],
      priorDuplicateWindows: new Map([["s2", "2026-05-04"]]),
    });
    expect(events).toHaveLength(0);
  });
});
