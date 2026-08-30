import { describe, it, expect } from "vitest";
import {
  formatCapBreach,
  formatCapWarning,
  formatReserveWithdrawal,
  formatFlexDigest,
  formatMorningDigest,
} from "@/lib/alerts/format";
import type { BudgetSnapshot } from "@/lib/alerts/evaluate";
import type { ReserveEvent } from "@/lib/alerts/reserve";

const over: BudgetSnapshot = {
  categoryId: "c", category: "Groceries", state: "over",
  target: 1200, netSpent: 1240, pct: 103, remaining: -40, daysLeft: 6,
};
const warn: BudgetSnapshot = {
  categoryId: "c", category: "Dining", state: "warning",
  target: 200, netSpent: 168, pct: 84, remaining: 32, daysLeft: 11,
};
const draw: ReserveEvent = {
  type: "reserve_withdrawal", txnId: "t", categoryId: "c", category: "Car maintenance",
  amount: 420, reserveBalance: 640, occurredAt: "2026-06-03", merchant: "Repco",
};

describe("formatCapBreach", () => {
  it("names the category, both amounts, and the percentage", () => {
    const msg = formatCapBreach(over);
    expect(msg).toContain("Groceries");
    expect(msg).toContain("$1,240");
    expect(msg).toContain("$1,200");
    expect(msg).toContain("103%");
  });
});

describe("formatCapWarning", () => {
  it("names the category and the percentage", () => {
    const msg = formatCapWarning(warn);
    expect(msg).toContain("Dining");
    expect(msg).toContain("84%");
  });
});

describe("formatReserveWithdrawal", () => {
  it("names the fund, the drawdown, and the remaining balance", () => {
    const msg = formatReserveWithdrawal(draw);
    expect(msg).toContain("Car maintenance");
    expect(msg).toContain("$420");
    expect(msg).toContain("$640");
  });
});

describe("formatFlexDigest", () => {
  it("states the flex amount and a one-line cap summary", () => {
    const msg = formatFlexDigest({ flexAmount: 530, capsOver: 1, capsWarning: 2 });
    expect(msg).toContain("$530");
    expect(msg).toMatch(/1 over/);
    expect(msg).toMatch(/2 near/);
  });

  it("reads cleanly when nothing is over or near", () => {
    const msg = formatFlexDigest({ flexAmount: 800, capsOver: 0, capsWarning: 0 });
    expect(msg).toContain("$800");
    expect(msg.toLowerCase()).toContain("all caps on track");
  });
});

describe("formatMorningDigest", () => {
  it("coalesces multiple alerts into one message with a line per alert", () => {
    const msg = formatMorningDigest([
      formatCapBreach(over),
      formatReserveWithdrawal(draw),
    ]);
    expect(msg).toContain("Groceries");
    expect(msg).toContain("Car maintenance");
    // one line per alert
    expect(msg.split("\n").filter((l) => l.trim()).length).toBeGreaterThanOrEqual(3);
  });

  it("returns empty string for no alerts (nothing to send)", () => {
    expect(formatMorningDigest([])).toBe("");
  });
});
