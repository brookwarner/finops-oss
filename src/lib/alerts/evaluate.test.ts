import { describe, it, expect } from "vitest";
import { decideCapAlerts, type BudgetSnapshot } from "@/lib/alerts/evaluate";

function snap(state: BudgetSnapshot["state"], over = {}): BudgetSnapshot {
  return {
    categoryId: "cat-groceries",
    category: "Groceries",
    state,
    target: 1200,
    netSpent: state === "over" ? 1240 : state === "warning" ? 1010 : 300,
    pct: state === "over" ? 103 : state === "warning" ? 84 : 25,
    remaining: state === "over" ? -40 : state === "warning" ? 190 : 900,
    daysLeft: 6,
    ...over,
  };
}

describe("decideCapAlerts — upward crosses fire, deliverable", () => {
  it("fires cap_warning when ok → warning", () => {
    const events = decideCapAlerts([snap("warning")], new Map([["cat-groceries", "ok"]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cap_warning", state: "warning", deliver: true });
  });

  it("fires cap_breach when warning → over", () => {
    const events = decideCapAlerts([snap("over")], new Map([["cat-groceries", "warning"]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cap_breach", state: "over", deliver: true });
  });

  it("fires only cap_breach (not warning) when ok → over skips the warning band", () => {
    const events = decideCapAlerts([snap("over")], new Map([["cat-groceries", "ok"]]));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("cap_breach");
  });

  it("treats an unseen budget (no prior state) as starting from ok", () => {
    const events = decideCapAlerts([snap("over")], new Map());
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("cap_breach");
  });
});

describe("decideCapAlerts — no re-fire when unchanged", () => {
  it("emits nothing when state holds at over", () => {
    expect(decideCapAlerts([snap("over")], new Map([["cat-groceries", "over"]]))).toEqual([]);
  });

  it("emits nothing when state holds at ok", () => {
    expect(decideCapAlerts([snap("ok")], new Map([["cat-groceries", "ok"]]))).toEqual([]);
  });
});

describe("decideCapAlerts — downward crosses record a non-delivered marker", () => {
  it("records cap_ok (no delivery) when over → ok, so a later re-cross can fire", () => {
    const events = decideCapAlerts([snap("ok")], new Map([["cat-groceries", "over"]]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "cap_ok", state: "ok", deliver: false });
  });

  it("records a non-delivered marker when over → warning (a recovery, not a new breach)", () => {
    const events = decideCapAlerts([snap("warning")], new Map([["cat-groceries", "over"]]));
    expect(events).toHaveLength(1);
    expect(events[0].deliver).toBe(false);
    expect(events[0].state).toBe("warning");
  });
});

describe("decideCapAlerts — full re-cross sequence", () => {
  it("ok→warning→over→ok→over yields warning, breach, marker, breach", () => {
    const cat = "cat-groceries";
    let last: BudgetSnapshot["state"] = "ok";
    const delivered: string[] = [];
    const markers: string[] = [];

    for (const cur of ["warning", "over", "ok", "over"] as const) {
      const events = decideCapAlerts([snap(cur)], new Map([[cat, last]]));
      for (const e of events) {
        if (e.deliver) delivered.push(e.type);
        else markers.push(e.type);
        last = e.state; // recorder persists the new state
      }
    }

    expect(delivered).toEqual(["cap_warning", "cap_breach", "cap_breach"]);
    expect(markers).toEqual(["cap_ok"]);
  });
});

describe("decideCapAlerts — only budgets that changed produce events", () => {
  it("handles multiple budgets independently", () => {
    const snaps = [
      { ...snap("over"), categoryId: "a", category: "A" },
      { ...snap("ok"), categoryId: "b", category: "B" },
    ];
    const events = decideCapAlerts(snaps, new Map([["a", "warning"], ["b", "ok"]]));
    expect(events).toHaveLength(1);
    expect(events[0].categoryId).toBe("a");
  });
});
