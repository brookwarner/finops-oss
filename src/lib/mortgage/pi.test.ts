import { describe, it, expect } from "vitest";
import {
  summariseMortgagePI,
  estimatePayoff,
  groupPartLegs,
  attributeInterest,
  matchContractualMeta,
  buildTrancheRow,
  buildRevolvingFacilities,
  type SummariseInput,
  type MortgageTxn,
  type MortgagePartMeta,
} from "./pi";

// Fixed "now" mid-year so trailing-90d and YTD windows both capture our txns.
const NOW = new Date("2026-06-15T00:00:00Z");

// Sign convention: debits negative, credits positive. A monthly repayment of a
// tranche is two legs both categorised "Mortgage Part N":
//   checking debit -1210 (cash out)  +  loan credit +1210 (lands on the loan).
// The interest charge is a debit on the loan account.
function repayment(name: string, checkingAcct: string, loanAcct: string, on: string, gross: number) {
  return [
    { category_name: name, account_id: checkingAcct, amount: -gross, occurred_at: on },
    { category_name: name, account_id: loanAcct, amount: gross, occurred_at: on },
  ];
}
function interest(loanAcct: string, on: string, charge: number) {
  return { category_name: "Mortgage Interest", account_id: loanAcct, amount: -charge, occurred_at: on };
}

describe("estimatePayoff", () => {
  it("amortises to a finite month count when the payment beats interest", () => {
    // $100k at 0.5%/mo, $2000/mo → 57.7 months, rounded up to 58.
    const p = estimatePayoff({ balance: 100_000, monthlyPayment: 2000, monthlyRate: 0.005 });
    expect(p.monthsRemaining).toBe(58);
    expect(p.annualRatePct).toBeCloseTo(6, 5);
  });

  it("returns null months when the payment cannot cover interest", () => {
    const p = estimatePayoff({ balance: 100_000, monthlyPayment: 400, monthlyRate: 0.005 });
    expect(p.monthsRemaining).toBeNull(); // 0.005*100k = 500 > 400
  });

  it("handles a zero interest rate as straight-line payoff", () => {
    const p = estimatePayoff({ balance: 1200, monthlyPayment: 100, monthlyRate: 0 });
    expect(p.monthsRemaining).toBe(12);
  });

  it("reports a paid-off balance as zero months", () => {
    expect(estimatePayoff({ balance: 0, monthlyPayment: 100, monthlyRate: 0.01 }).monthsRemaining).toBe(0);
  });
});

describe("summariseMortgagePI", () => {
  it("splits interest/principal per tranche when each has its own loan account", () => {
    const partTxns = [
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-03-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 2", "chk", "loan2", "2026-05-20T00:00:00Z", 1000),
    ];
    const interestTxns = [
      interest("loan1", "2026-03-31T00:00:00Z", 400),
      interest("loan1", "2026-05-31T00:00:00Z", 400),
      interest("loan2", "2026-05-31T00:00:00Z", 250),
    ];
    const accounts = [
      { id: "loan1", name: "Choices Part 1", balance_current: -120000, type: "loan" },
      { id: "loan2", name: "Choices Part 2", balance_current: -80000, type: "loan" },
      { id: "chk", name: "Everyday", balance_current: 5000 },
    ];
    const r = summariseMortgagePI({ partTxns, interestTxns, accounts } as SummariseInput, { now: NOW });

    const p1 = r.parts.find((p) => p.name === "Mortgage Part 1")!;
    expect(p1.grossYtd).toBe(2420);
    expect(p1.interestYtd).toBe(800);
    expect(p1.principalYtd).toBe(1620); // 2420 − 800
    expect(p1.loanAccountName).toBe("Choices Part 1");
    expect(p1.balance).toBe(120000);

    // Aggregate: gross 3420, interest 1050, principal 2370.
    expect(r.totals.grossYtd).toBe(3420);
    expect(r.totals.interestYtd).toBe(1050);
    expect(r.totals.principalYtd).toBe(2370);
    expect(r.estimated).toBe(true);
    // A real payment beats interest, so we get a finite mortgage-free date.
    expect(r.payoff.monthsRemaining).not.toBeNull();
    expect(r.payoff.freeDate).toMatch(/^\d{4}-\d{2}$/);
  });

  it("falls back to aggregate-only interest when tranches share a loan account", () => {
    const partTxns = [
      ...repayment("Mortgage Part 1", "chk", "loan", "2026-05-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 2", "chk", "loan", "2026-05-20T00:00:00Z", 1000),
    ];
    const interestTxns = [interest("loan", "2026-05-31T00:00:00Z", 600)];
    const accounts = [{ id: "loan", name: "Choices", balance_current: -200000, type: "loan" }];
    const r = summariseMortgagePI({ partTxns, interestTxns, accounts } as SummariseInput, { now: NOW });

    // Shared account → interest can't be split per tranche, so per-tranche
    // interest/principal are null and the interest is reported as "other" rather
    // than guessing a split that would mis-state principal.
    for (const p of r.parts) {
      expect(p.interestYtd).toBeNull();
      expect(p.principalYtd).toBeNull();
    }
    expect(r.totals.interestYtd).toBe(0);
    expect(r.totals.otherInterestYtd).toBe(600);
    expect(r.totals.grossYtd).toBe(2210);
    expect(r.totals.principalYtd).toBe(2210);
  });

  it("keeps interest-only/revolving interest out of the principal math", () => {
    // the owner's real structure: amortising tranche (091) + a non-reducing revolving
    // facility whose interest charge posts to its own account with no repayment.
    const partTxns = repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210);
    const interestTxns = [
      interest("loan1", "2026-05-31T00:00:00Z", 400), // tranche interest
      interest("revolving", "2026-05-31T00:00:00Z", 99), // interest-only facility
    ];
    const accounts = [
      { id: "loan1", name: "Choices091", balance_current: -120000, type: "loan" },
      { id: "revolving", name: "Choices", balance_current: -19738.79, type: "loan" },
    ];
    const r = summariseMortgagePI({ partTxns, interestTxns, accounts } as SummariseInput, { now: NOW });

    // Tranche principal uses only the tranche's own interest (400), not the 99.
    expect(r.totals.interestYtd).toBe(400);
    expect(r.totals.principalYtd).toBe(810); // 1210 − 400
    expect(r.totals.otherInterestYtd).toBe(99); // revolving cost, no principal
    // The revolving facility isn't a repaying tranche, so it's not in parts.
    expect(r.parts.map((p) => p.name)).toEqual(["Mortgage Part 1"]);
  });

  it("uses contractual terms from partsMeta, matched by repayment amount", () => {
    // Three monthly payments in the trailing window so the observed run-rate
    // (~$1,210/mo) matches the contractual repayment without an account-id hint.
    const partTxns = [
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-04-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-06-10T00:00:00Z", 1210),
    ];
    const interestTxns = [interest("loan1", "2026-05-31T00:00:00Z", 499)];
    const accounts = [{ id: "loan1", name: "Choices091", balance_current: -240000, type: "loan" }];
    const partsMeta = [
      { label: "Choices091", kind: "table" as const, accountId: null, rate: 4.99, fixedUntil: "2028-02-21", repayment: 1210, notes: null },
    ];
    const r = summariseMortgagePI({ partTxns, interestTxns, accounts, partsMeta } as SummariseInput, { now: NOW });
    const p1 = r.parts[0];
    expect(p1.rateSource).toBe("contractual");
    expect(p1.ratePct).toBe(4.99);
    expect(p1.fixedUntil).toBe("2028-02-21");
    expect(p1.refixMonths).toBe(20); // Jun 2026 → Feb 2028
    expect(r.estimated).toBe(false); // all tranches contractual
  });

  it("models an extra-repayment scenario, saving months and interest", () => {
    const partTxns = repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210);
    const interestTxns = [interest("loan1", "2026-05-31T00:00:00Z", 499)];
    const accounts = [{ id: "loan1", name: "Choices091", balance_current: -240000, type: "loan" }];
    const partsMeta = [
      // accountId hint → matches regardless of the observed run-rate.
      { label: "Choices091", kind: "table" as const, accountId: "loan1", rate: 4.99, fixedUntil: "2028-02-21", repayment: 1210, notes: null },
    ];
    const r = summariseMortgagePI(
      { partTxns, interestTxns, accounts, partsMeta } as SummariseInput,
      { now: NOW, scenario: { extraPerMonth: 500 } },
    );
    expect(r.scenario.applied).toBe(true);
    expect(r.scenario.monthsRemaining!).toBeLessThan(r.payoff.monthsRemaining!);
    expect(r.scenario.interestSaved!).toBeGreaterThan(0);
    expect(r.parts[0].scenarioPayoff!.monthsSaved!).toBeGreaterThan(0);
  });

  it("surfaces an interest-only facility as a flagged revolving line", () => {
    const partTxns = repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210);
    const interestTxns = [
      interest("loan1", "2026-05-31T00:00:00Z", 499),
      interest("revolving", "2026-05-31T00:00:00Z", 99),
    ];
    const accounts = [
      { id: "loan1", name: "Choices091", balance_current: -240000, type: "loan" },
      { id: "revolving", name: "Choices", balance_current: -19738.79, type: "loan" },
    ];
    const partsMeta = [
      { label: "Choices (revolving)", kind: "revolving" as const, accountId: "revolving", rate: null, fixedUntil: null, repayment: null, notes: "Non-reducing / interest-only" },
    ];
    const r = summariseMortgagePI({ partTxns, interestTxns, accounts, partsMeta } as SummariseInput, { now: NOW });
    expect(r.revolving).toHaveLength(1);
    expect(r.revolving[0]).toMatchObject({ name: "Choices", balance: 19738.79, interestYtd: 99, notes: "Non-reducing / interest-only" });
    // Revolving is excluded from the mortgage-free date (tranches only).
    expect(r.parts.map((p) => p.name)).toEqual(["Mortgage Part 1"]);
  });

  it("excludes Mortgage Interest posted to a non-loan account", () => {
    // Real-data quirk: the revolving facility's debit interest is charged to a
    // *checking* account (e.g. Westpac Everyday) yet tagged Mortgage Interest. It
    // must not masquerade as a mortgage facility — only loan-account interest is
    // cost-of-borrowing. Without the loan-account scope this checking charge would
    // surface as a phantom revolving line.
    const partTxns = repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210);
    const interestTxns = [
      interest("loan1", "2026-05-31T00:00:00Z", 400), // real tranche interest
      interest("chk", "2026-05-21T00:00:00Z", 89.5), // debited from checking, not a loan
    ];
    const accounts = [
      { id: "loan1", name: "Choices091", balance_current: -120000, type: "loan" },
      { id: "chk", name: "Westpac Everyday", balance_current: 5000, type: "checking" },
    ];
    const r = summariseMortgagePI({ partTxns, interestTxns, accounts } as SummariseInput, { now: NOW });
    expect(r.revolving).toHaveLength(0);
    expect(r.totals.otherInterestYtd).toBe(0);
    expect(r.totals.interestYtd).toBe(400); // only the loan-account charge
  });

  it("returns empty totals when there is no mortgage data", () => {
    const r = summariseMortgagePI({ partTxns: [], interestTxns: [], accounts: [] }, { now: NOW });
    expect(r.parts).toEqual([]);
    expect(r.totals).toEqual({
      grossYtd: 0,
      interestYtd: 0,
      principalYtd: 0,
      otherInterestYtd: 0,
      balance: 0,
    });
    expect(r.payoff.monthsRemaining).toBe(0);
  });
});

// --- Extracted pure phase helpers ------------------------------------------
// summariseMortgagePI wires these together; covering each in isolation pins the
// behaviour the (formerly monolithic) orchestrator used to validate only e2e.

const WINDOWS = {
  now: NOW,
  yearStart: new Date(Date.UTC(2026, 0, 1)),
  trailingStart: new Date(NOW.getTime() - 90 * 86400000),
};

describe("groupPartLegs", () => {
  it("splits gross YTD vs trailing run-rate and resolves the loan account from credit legs", () => {
    const txns: MortgageTxn[] = [
      // Two trailing repayments + one earlier-in-year (pre-trailing-window) one.
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-02-10T00:00:00Z", 1210), // YTD only
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-04-20T00:00:00Z", 1210), // YTD + trailing
      ...repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210), // YTD + trailing
    ];
    const g = groupPartLegs(txns, WINDOWS);
    const p = g.accum.get("Mortgage Part 1")!;
    expect(p.grossYtd).toBe(3630); // all three debit legs
    expect(p.trailingGross).toBe(2420); // only the two within 90 days
    expect(g.loanAccount.get("Mortgage Part 1")).toBe("loan1"); // credit legs land here
    expect(g.accountClaimCount.get("loan1")).toBe(1);
  });

  it("flags an account claimed by two tranches (not uniquely attributable)", () => {
    const txns: MortgageTxn[] = [
      ...repayment("Mortgage Part 1", "chk", "shared", "2026-05-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 2", "chk", "shared", "2026-05-20T00:00:00Z", 1000),
    ];
    const g = groupPartLegs(txns, WINDOWS);
    expect(g.loanAccount.get("Mortgage Part 1")).toBe("shared");
    expect(g.loanAccount.get("Mortgage Part 2")).toBe("shared");
    expect(g.accountClaimCount.get("shared")).toBe(2);
  });

  it("picks the most-hit credit account when legs land on several", () => {
    const txns: MortgageTxn[] = [
      { category_name: "Mortgage Part 1", account_id: "minor", amount: 100, occurred_at: "2026-05-20T00:00:00Z" },
      { category_name: "Mortgage Part 1", account_id: "major", amount: 900, occurred_at: "2026-05-20T00:00:00Z" },
    ];
    const g = groupPartLegs(txns, WINDOWS);
    expect(g.loanAccount.get("Mortgage Part 1")).toBe("major");
  });
});

describe("attributeInterest", () => {
  it("sums YTD + trailing per loan account and ignores non-loan / credit charges", () => {
    const txns: MortgageTxn[] = [
      interest("loan1", "2026-02-28T00:00:00Z", 400), // YTD only
      interest("loan1", "2026-05-31T00:00:00Z", 410), // YTD + trailing
      interest("chk", "2026-05-21T00:00:00Z", 99), // non-loan account → ignored
      { category_name: "Mortgage Interest", account_id: "loan1", amount: 50, occurred_at: "2026-05-10T00:00:00Z" }, // credit → ignored
    ];
    const r = attributeInterest(txns, new Set(["loan1"]), WINDOWS);
    expect(r.ytdByAccount.get("loan1")).toBe(810);
    expect(r.trailingByAccount.get("loan1")).toBe(410);
    expect(r.ytdByAccount.has("chk")).toBe(false);
    expect(r.totalAllYtd).toBe(810);
  });
});

describe("matchContractualMeta", () => {
  const meta: MortgagePartMeta[] = [
    { label: "A", kind: "table", accountId: "loanA", rate: 4.99, fixedUntil: "2028-01-01", repayment: 1210, notes: null },
    { label: "B", kind: "table", accountId: null, rate: 5.5, fixedUntil: null, repayment: 800, notes: null },
  ];

  it("matches by exact loan account first", () => {
    const used = new Set<number>();
    const m = matchContractualMeta(meta, used, "loanA", 9999); // payment irrelevant given the account hit
    expect(m?.label).toBe("A");
    expect(used.has(0)).toBe(true);
  });

  it("falls back to nearest repayment within tolerance and consumes the row", () => {
    const used = new Set<number>();
    const m = matchContractualMeta(meta, used, null, 820); // closest to B's 800 (diff 20 ≤ 80)
    expect(m?.label).toBe("B");
    // A second tranche can't re-claim B.
    expect(matchContractualMeta(meta, used, null, 800)?.label).not.toBe("B");
  });

  it("returns null when the nearest repayment is outside tolerance", () => {
    const used = new Set<number>();
    expect(matchContractualMeta(meta, used, null, 2000)).toBeNull(); // 2000 vs 1210/800, >80 off
  });
});

describe("buildTrancheRow", () => {
  function setup(extra?: { partsMeta?: MortgagePartMeta[]; scenario?: { extraPerMonth?: number } }) {
    const partTxns = repayment("Mortgage Part 1", "chk", "loan1", "2026-05-20T00:00:00Z", 1210);
    const interestTxns = [interest("loan1", "2026-05-31T00:00:00Z", 400)];
    const grouping = groupPartLegs(partTxns, WINDOWS);
    const interestBy = attributeInterest(interestTxns, new Set(["loan1"]), WINDOWS);
    return {
      grouping,
      interestBy,
      args: {
        name: "Mortgage Part 1",
        accum: grouping.accum.get("Mortgage Part 1")!,
        grouping,
        interest: interestBy,
        balanceByAccount: new Map([["loan1", 120000]]),
        nameByAccount: new Map([["loan1", "Choices091"]]),
        tableMeta: extra?.partsMeta ?? [],
        usedMeta: new Set<number>(),
        now: NOW,
        monthsElapsed: 6,
        scenActive: !!extra?.scenario,
        scenario: extra?.scenario,
      },
    };
  }

  it("derives the interest/principal split and an estimated rate with no contractual meta", () => {
    const row = buildTrancheRow(setup().args);
    expect(row.loanAccountName).toBe("Choices091");
    expect(row.balance).toBe(120000);
    expect(row.grossYtd).toBe(1210);
    expect(row.interestYtd).toBe(400);
    expect(row.principalYtd).toBe(810);
    expect(row.rateSource).toBe("estimated");
    expect(row.payoff).not.toBeNull();
    expect(row.scenarioPayoff).toBeNull();
  });

  it("uses contractual rate + repayment and computes a scenario payoff when active", () => {
    const partsMeta: MortgagePartMeta[] = [
      { label: "Choices091", kind: "table", accountId: "loan1", rate: 4.99, fixedUntil: "2028-02-21", repayment: 1210, notes: null },
    ];
    const row = buildTrancheRow(setup({ partsMeta, scenario: { extraPerMonth: 500 } }).args);
    expect(row.rateSource).toBe("contractual");
    expect(row.ratePct).toBe(4.99);
    expect(row.refixMonths).toBe(20);
    expect(row.scenarioPayoff!.monthsSaved!).toBeGreaterThan(0);
  });

  it("leaves interest/principal null when the loan account is shared (not attributable)", () => {
    const partTxns = [
      ...repayment("Mortgage Part 1", "chk", "shared", "2026-05-20T00:00:00Z", 1210),
      ...repayment("Mortgage Part 2", "chk", "shared", "2026-05-20T00:00:00Z", 1000),
    ];
    const grouping = groupPartLegs(partTxns, WINDOWS);
    const interestBy = attributeInterest([interest("shared", "2026-05-31T00:00:00Z", 600)], new Set(["shared"]), WINDOWS);
    const row = buildTrancheRow({
      name: "Mortgage Part 1",
      accum: grouping.accum.get("Mortgage Part 1")!,
      grouping,
      interest: interestBy,
      balanceByAccount: new Map([["shared", 200000]]),
      nameByAccount: new Map([["shared", "Choices"]]),
      tableMeta: [],
      usedMeta: new Set<number>(),
      now: NOW,
      monthsElapsed: 6,
      scenActive: false,
    });
    expect(row.interestYtd).toBeNull();
    expect(row.principalYtd).toBeNull();
  });
});

describe("buildRevolvingFacilities", () => {
  it("surfaces interest-bearing accounts no tranche claims, and skips claimed ones", () => {
    const rev = buildRevolvingFacilities({
      interestYtdByAccount: new Map([
        ["loan1", 400], // claimed by a tranche → excluded
        ["revolving", 99], // unclaimed → surfaced
      ]),
      loanAccount: new Map([["Mortgage Part 1", "loan1"]]),
      revolvingMeta: [
        { label: "Choices (revolving)", kind: "revolving", accountId: "revolving", rate: null, fixedUntil: null, repayment: null, notes: "Non-reducing" },
      ],
      balanceByAccount: new Map([["revolving", 19738.79]]),
      nameByAccount: new Map([["revolving", "Choices"]]),
    });
    expect(rev).toHaveLength(1);
    expect(rev[0]).toMatchObject({ accountId: "revolving", name: "Choices", balance: 19738.79, interestYtd: 99, notes: "Non-reducing" });
  });
});
