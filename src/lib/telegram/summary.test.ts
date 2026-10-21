import { describe, it, expect } from "vitest";
import { summariseAction } from "@/lib/telegram/summary";

describe("summariseAction", () => {
  it("renders a budget target change", () => {
    expect(summariseAction({ kind: "set_budget_target", categoryId: "c", categoryName: "Groceries", monthlyTarget: 1800, previousTarget: 1700 }))
      .toBe("Set *Groceries* cap $1,700 → *$1,800*.");
  });
  it("renders a recategorise", () => {
    expect(summariseAction({ kind: "recategorise", transactionId: "t", txnLabel: "Countdown $43.00 (2 Jun)", categoryId: "c", categoryName: "Pets" }))
      .toBe("Recategorise *Countdown $43.00 (2 Jun)* → *Pets*.");
  });
  it("renders accept_suggestions with a count", () => {
    expect(summariseAction({ kind: "accept_suggestions", categoryName: "Pets", transactionIds: ["a","b","c"] }))
      .toBe("Accept *3* inbox suggestion(s) in *Pets*.");
  });
});
