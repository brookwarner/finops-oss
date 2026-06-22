import { describe, it, expect } from "vitest";
import assert from "node:assert";
import { money, pct, budgetLine, budgetSentence, reviewLine, forecastLines, budgetHistoryLines, budgetSetLine, categoriseResultLine, fiLines, positionLine, cashflowLines, assetLines } from "./format.mjs";

describe("money", () => {
  it("formats whole dollars with NZ grouping", () => {
    expect(money(1200)).toBe("$1,200");
    expect(money(0)).toBe("$0");
    expect(money(340.6)).toBe("$341");
  });
  it("handles negatives with a leading sign", () => {
    expect(money(-1234.5)).toBe("-$1,235");
  });
});

describe("pct", () => {
  it("rounds to a whole percent", () => {
    expect(pct(28.4)).toBe("28%");
    expect(pct(100)).toBe("100%");
  });
});

describe("budgetSentence", () => {
  it("matches the design phrasing for a monthly cap", () => {
    const row = { category: "Groceries", kind: "monthly_cap", target: 1200, netSpent: 340, pct: 28, projected: 567 };
    expect(budgetSentence(row, 18)).toBe(
      "Groceries: $340 of $1,200 (28%), 18 days left. On pace: $567 projected.",
    );
  });
  it("describes a reserve balance", () => {
    const row = { category: "Vet", kind: "reserve", netSpent: 50, reserveBalance: -20 };
    expect(budgetSentence(row, 10)).toContain("overdrawn");
  });
  it("frames savings as money set aside this cycle, not spend", () => {
    const row = { category: "Savings Out", kind: "savings", target: 439, netSpent: 1, pct: 0 };
    expect(budgetSentence(row, 10)).toBe("Savings Out: $1 of $439 set aside this cycle (0%).");
  });
  it("flags a met savings goal", () => {
    const row = { category: "Investments", kind: "savings", target: 140, netSpent: 140, pct: 100 };
    expect(budgetSentence(row, 10)).toContain("Goal met");
  });
  it("surfaces pending (unsettled) spend as the true committed position — the beer case", () => {
    const row = { category: "Alcohol", kind: "monthly_cap", target: 89.89, netSpent: 0, pct: 0, pendingSpent: 56.97 };
    const s = budgetSentence(row, 12);
    expect(s).toContain("Incl. $57 pending");
    expect(s).toContain("$57 of $90 committed");
  });
});

describe("budgetLine", () => {
  it("flags an over-budget category", () => {
    const row = { category: "Dining", kind: "monthly_cap", target: 200, netSpent: 260, pct: 130, projected: 300, status: "over" };
    expect(budgetLine(row, 5)).toContain("OVER");
  });
  it("renders a reserve with its accrued balance", () => {
    const row = { category: "Vet", kind: "reserve", netSpent: 0, reserveBalance: 480, status: "ok" };
    expect(budgetLine(row, 5)).toContain("reserve $480");
  });
  it("appends a pending tag for unsettled spend", () => {
    const row = { category: "Alcohol", kind: "monthly_cap", target: 89.89, netSpent: 0, pct: 0, status: "ok", pendingSpent: 56.97 };
    expect(budgetLine(row, 12)).toContain("+$57 pending");
  });
  it("renders savings as set-aside progress toward the goal", () => {
    const row = { category: "Savings Out", kind: "savings", target: 439, netSpent: 1, pct: 0, status: "ok" };
    const line = budgetLine(row, 5);
    expect(line).toContain("saved $1 of $439 this cycle");
    expect(line).not.toContain("✓");
  });
  it("marks a savings goal as met once it hits 100%", () => {
    const row = { category: "Investments", kind: "savings", target: 140, netSpent: 140, pct: 100, status: "ok" };
    expect(budgetLine(row, 5)).toContain("✓ goal met");
  });
});

describe("reviewLine", () => {
  it("includes date, amount and merchant", () => {
    const t = { occurred_at: "2026-06-01T10:00:00Z", amount: -42.5, merchant: "Countdown", account: "Everyday" };
    const line = reviewLine(t);
    expect(line).toContain("2026-06-01");
    expect(line).toContain("-$43");
    // money rounds the magnitude: -42.5 -> -$43
    expect(line).toContain("Countdown");
  });
  it("shows an 8-char id handle", () => {
    const line = reviewLine({ id: "a1b2c3d4-0000-4000-8000-000000000000", occurred_at: "2026-06-01T00:00:00Z", amount: -42.5, merchant: "PAKNSAVE", account: "Everyday" });
    expect(line).toMatch(/\[a1b2c3d4\]/);
    expect(line).toMatch(/PAKNSAVE/);
  });
});

describe("budgetSetLine", () => {
  it("shows before -> after", () => {
    expect(budgetSetLine({ category: "Groceries", previousTarget: 1200, newTarget: 1350 })).toBe("Groceries  $1,200 → $1,350");
  });
});

describe("categoriseResultLine", () => {
  it("nudges a runnable apply-similar command when similar > 0 and merchant known", () => {
    const line = categoriseResultLine({ category: "Groceries", updated: 1, similarCount: 5, similarMerchant: "PAKNSAVE" });
    expect(line).toMatch(/categorised 1/);
    expect(line).toMatch(/5 similar/);
    expect(line).toMatch(/apply-similar "PAKNSAVE" "Groceries"/);
  });
  it("falls back to a plain count when the rule has no merchant (description-based)", () => {
    const line = categoriseResultLine({ category: "Groceries", updated: 1, similarCount: 5, similarMerchant: null });
    expect(line).toMatch(/categorised 1/);
    expect(line).toMatch(/5 similar/);
    expect(line).not.toMatch(/apply-similar "/);
  });
  it("omits the nudge when no similar", () => {
    const line = categoriseResultLine({ category: "Groceries", updated: 2, similarCount: 0 });
    expect(line).toMatch(/categorised 2/);
    expect(line).not.toMatch(/apply-similar/);
  });
});

describe("budgetHistoryLines", () => {
  it("renders a sparkline + per-cycle lines", () => {
    const series = [
      { period_start: "2026-05-20", period_end: "2026-06-20", target: 1200, effective_spend: 1040, pct: 87, status: "warning" },
      { period_start: "2026-04-20", period_end: "2026-05-20", target: 1200, effective_spend: 900, pct: 75, status: "ok" },
    ];
    const out = budgetHistoryLines("Groceries", series);
    expect(out).toMatch(/Groceries/);
    expect(out).toMatch(/2026-05/);
    expect(out).toMatch(/87%/);
  });
});

describe("forecastLines", () => {
  it("summarises verdict, trough, and payday", () => {
    const data = {
      startBalance: 145,
      verdict: { makesIt: true, margin: 200, text: "You'll clear payday with $200 to spare" },
      trough: { date: "2026-06-14", balance: 200 },
      nextPayday: { date: "2026-06-05", amount: 2300 },
      context: { reservesEarmarked: 500, revolvingDrawn: -19738 },
    };
    const lines = forecastLines(data);
    expect(lines[0]).toMatch(/clear payday/);
    expect(lines.join("\n")).toMatch(/2026-06-14/);
    expect(lines.join("\n")).toMatch(/2026-06-05/);
  });

  it("omits the payday line when nextPayday is null", () => {
    const data = {
      startBalance: 145,
      verdict: { makesIt: false, margin: -50, text: "You're $50 short on the 14th" },
      trough: { date: "2026-06-14", balance: -50 },
      nextPayday: null,
      context: { reservesEarmarked: 500, revolvingDrawn: -19738 },
    };
    const lines = forecastLines(data);
    expect(lines.some((l) => l.includes("Next pay"))).toBe(false);
    expect(lines[0]).toMatch(/short/);
  });
});

describe("fiLines", () => {
  it("summarises FI %, number, monthly saved, and FI age vs target", () => {
    const data = {
      pctToFI: 0.18, fiNumber: 1900000, annualRecurringSpend: 76000,
      monthlyContribution: 2400, targetAge: 50,
      projection: { reached: true, fiDate: "2048-03", fiAge: 61 }, vsTargetYears: 11,
      assumptions: { swr: 0.04, contributionWindowMonths: 3 },
    };
    const lines = fiLines(data);
    assert.match(lines[0], /18% to FI/);
    assert.match(lines.join("\n"), /1,900,000/);
    assert.match(lines.join("\n"), /age 61/);
    assert.match(lines.join("\n"), /2,400\/mo/);
  });
  it("flags when nothing was saved and FI is not reached", () => {
    const data = {
      pctToFI: 0.02, fiNumber: 1900000, annualRecurringSpend: 76000,
      monthlyContribution: 0, targetAge: 50,
      projection: { reached: false, fiDate: null, fiAge: null }, vsTargetYears: null,
      assumptions: { swr: 0.04, contributionWindowMonths: 3 },
    };
    const lines = fiLines(data);
    assert.match(lines.join("\n"), /not on track/i);
    assert.match(lines.join("\n"), /Nothing saved/i);
  });
});

describe("positionLine", () => {
  it("shows earned, plan, run-rate and delta when planned > 0", () => {
    const line = positionLine({
      income: { actual: 7349.35, expected: 11270, expectedByNow: 6544, planned: 11270, recentRunRate: 9866.21 },
    });
    expect(line).toBe("Income: $7,349 earned · plan $11,270/mo · run-rate $9,866 (-$1,404 vs plan)");
  });

  it("omits the plan/run-rate segment when no income budget is set", () => {
    const line = positionLine({
      income: { actual: 5000, expected: 9000, expectedByNow: 5000, planned: 0, recentRunRate: 9000 },
    });
    expect(line).toBe("Income: $5,000 earned");
  });
});


describe("cashflowLines", () => {
  it("lists each scenario cash + credit zero-dates, verdict, and credit headroom", () => {
    const data = {
      startLiquid: 839, creditHeadroom: 37361,
      verdict: { makesIt: false, margin: -3800 },
      nextBills: { date: "2026-06-20", amount: 4674, count: 8 },
      inflows: [
        { id: "manual_secured", label: "Secured (likely)", amount: 21735, likelihood: "likely", expectedDate: null, taxRate: 0.39 },
        { id: "manual_spec", label: "Speculative", amount: 14385, likelihood: "uncertain", expectedDate: null, taxRate: 0 },
      ],
      lines: [
        { key: "actual", label: "Actual pace", cashZeroDate: "2026-06-20", creditZeroDate: "2026-09-30", weeksToCredit: 15 },
        { key: "bareEssentials", label: "Bare essentials", cashZeroDate: "2026-06-20", creditZeroDate: "2026-11-15", weeksToCredit: 22 },
      ],
    };
    const txt = cashflowLines(data).join("\n");
    expect(txt).toContain("cash 2026-06-20");
    expect(txt).toContain("credit 2026-09-30");
    expect(txt).toContain("37,361");
    expect(txt).toContain("Secured (likely)");
    expect(txt).toContain("21,735");
    // 21735 with taxRate 0.39 → 21735 * 0.61 = 13258.35 net → money rounds to "$13,258"
    expect(txt).toContain("13,258");
    expect(txt).toContain("net");
    // uses "expected:" prefix, not "owed:"
    expect(txt).toContain("expected:");
    expect(txt).not.toContain("owed:");
  });
  it("covered line reads as covered", () => {
    const data = {
      startLiquid: 5000, creditHeadroom: 40000, verdict: { makesIt: true, margin: 200 }, nextBills: null,
      lines: [{ key: "actual", label: "Actual pace", cashZeroDate: null, creditZeroDate: null, weeksToCredit: null }],
    };
    expect(cashflowLines(data).join("\n")).toContain("covered");
  });
  it("omits expected line when inflows is empty or missing", () => {
    const data = {
      startLiquid: 1000, creditHeadroom: 5000, verdict: { makesIt: true, margin: 100 }, nextBills: null,
      inflows: [],
      lines: [{ key: "actual", label: "Actual pace", cashZeroDate: null, creditZeroDate: null, weeksToCredit: null }],
    };
    expect(cashflowLines(data).join("\n")).not.toContain("expected:");
  });
});

describe("assetLines", () => {
  it("shows no-assets message when empty", () => {
    expect(assetLines({ assets: [] }).join("\n")).toContain("No manual assets");
  });
  it("shows basic asset without inflow", () => {
    const data = { assets: [{ name: "Home", balance: 900000, type: "other", feedsFI: false, autoRefreshed: false, id: "manual_home", loan: null, inflow: null }] };
    const txt = assetLines(data).join("\n");
    expect(txt).toContain("Home");
    expect(txt).toContain("$900,000");
    expect(txt).not.toContain("inflow");
  });
  it("shows inflow terms when present (pre-tax with rate)", () => {
    const data = { assets: [{ name: "Tax refund", balance: 1200, type: "receivable", feedsFI: false, autoRefreshed: false, id: "manual_tax", loan: null, inflow: { likelihood: "likely", expectedDate: "2026-07-01", preTax: true, taxRate: 0.33 } }] };
    const txt = assetLines(data).join("\n");
    expect(txt).toContain("inflow likely");
    expect(txt).toContain("by 2026-07-01");
    expect(txt).toContain("33% tax");
  });
  it("shows inflow terms without tax when preTax is false", () => {
    const data = { assets: [{ name: "Bond refund", balance: 2000, type: "receivable", feedsFI: false, autoRefreshed: false, id: "manual_bond", loan: null, inflow: { likelihood: "uncertain", expectedDate: null, preTax: false, taxRate: 0 } }] };
    const txt = assetLines(data).join("\n");
    expect(txt).toContain("inflow uncertain");
    expect(txt).not.toContain("tax");
    expect(txt).not.toContain("by "); // no date
  });
});

