import { describe, it, expect } from "vitest";
import { computeBudgets } from "@/lib/budgets/compute";
import { periodProgress } from "@/lib/budgets/period";

// Minimal fake of the supabase query builder used by computeBudgets.
// `txns` answers the paginated 3-month window query; `reserveTxns` answers the
// paginated all-history reserve query (the one that calls `.in("category_id", ...)`).
// `bufferAccount` answers the accounts query for the designated buffer account.
// `bufferTxns` answers the paginated buffer-account inflow query (uses `.gt("amount",0)`).
// The range() method returns a single page (the full dataset) so the pagination
// loop exits after one iteration — simulating a result set smaller than PAGE.
function fakeSupabase(data: {
  budgets: any[];
  txns: any[];
  uncatCount: number;
  categories?: any[];
  reserveTxns?: any[];
  pendingTxns?: any[];
  rules?: any[];
  bufferAccount?: { id: string; balance_current: number; is_reserve_buffer: boolean } | null;
  bufferTxns?: any[];
}) {
  return {
    from(table: string) {
      const builder: any = {
        _table: table,
        select(_sel: string, opts?: any) { builder._head = opts?.head; return builder; },
        eq(_col: string, _val: any) { return builder; },
        gte() { return builder; }, lt() { return builder; },
        not() { return builder; }, is() { return builder; }, order() { return builder; },
        in() { builder._in = true; return builder; },
        // gt() is used by loadBufferContext to filter inflows (amount > 0).
        gt() { builder._gt = true; return builder; },
        // range() returns a thenable that resolves with a single page (full data set);
        // since the data is smaller than PAGE the pagination loop exits immediately.
        range(_from: number, _to: number) {
          return {
            then(resolve: any) {
              if (table === "transactions" && builder._head) return resolve({ count: data.uncatCount, error: null });
              if (table === "transactions" && builder._in) return resolve({ data: data.reserveTxns ?? [], error: null });
              // Buffer inflow query: uses .gt("amount", 0) — distinguished by _gt flag.
              if (table === "transactions" && builder._gt) return resolve({ data: data.bufferTxns ?? [], error: null });
              return resolve({ data: data.txns, error: null });
            },
          };
        },
        then(resolve: any) {
          if (table === "budgets") return resolve({ data: data.budgets, error: null });
          if (table === "categories") return resolve({ data: data.categories ?? [], error: null });
          if (table === "pending_transactions") return resolve({ data: data.pendingTxns ?? [], error: null });
          if (table === "category_rules") return resolve({ data: data.rules ?? [], error: null });
          if (table === "accounts") {
            // loadBufferContext queries accounts with .eq("is_reserve_buffer", true).
            const acct = data.bufferAccount ?? null;
            return resolve({ data: acct ? [acct] : [], error: null });
          }
          if (table === "transactions" && builder._head) return resolve({ count: data.uncatCount, error: null });
          if (table === "transactions" && builder._in) return resolve({ data: data.reserveTxns ?? [], error: null });
          if (table === "transactions" && builder._gt) return resolve({ data: data.bufferTxns ?? [], error: null });
          return resolve({ data: data.txns, error: null });
        },
      };
      return builder;
    },
  } as any;
}

const period = { start: new Date("2026-06-20T00:00:00"), end: new Date("2026-07-20T00:00:00") };

it("reserve accrues monthly_target from the fixed start date (not a 3-month cap)", async () => {
  // $50/mo reserve, opening $0 on 1 Jan 2026, with $100 spent since then. By
  // 25 Jun 2026, ~5.2 months have accrued. The old code capped accrual at 3
  // periods (~$160); the reset model must accrue the full elapsed span.
  const supabase = fakeSupabase({
    budgets: [{ id: "b5", monthly_target: 50, kind: "reserve", category_id: "c5",
                categories: { id: "c5", name: "Coffee Beans", group: "Discretionary" } }],
    txns: [], // nothing categorised in the 3-month window
    reserveTxns: [ // since-start query: $100 of spend (debit, negative amount)
      { id: "h1", amount: -100, category_id: "c5", occurred_at: "2026-02-10T00:00:00" },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Coffee Beans")!;
  // monthsElapsed = monthsBetween(Jan, Jun)=5 + dayOfPeriod/periodLength (6/30=0.2) = 5.2
  // accrual = 50 * 5.2 = 260; spend = 100 → balance = 160.
  expect(row.reserveBalance).toBeCloseTo(160, 5);
});

it("reserve balance goes negative when spend exceeds accrual (overdrawn fund)", async () => {
  const supabase = fakeSupabase({
    budgets: [{ id: "b6", monthly_target: 50, kind: "reserve", category_id: "c6",
                categories: { id: "c6", name: "Home Improvement", group: "Home" } }],
    txns: [],
    reserveTxns: [ // $900 spent since start, far above the ~$260 accrued
      { id: "h2", amount: -900, category_id: "c6", occurred_at: "2026-02-10T00:00:00" },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Home Improvement")!;
  // accrual = 50 * 5.2 = 260; spend = 900 → balance = -640. Overdrawn reserves
  // read their true negative position rather than clamping to $0 (which hid how
  // far underwater a fund was — a -$17 fund looked identical to a -$1,600 one).
  expect(row.reserveBalance).toBeCloseTo(-640, 5);
});

it("savings is a contribution goal: per-cycle set-aside, no notional balance, never 'over'", async () => {
  // $439/mo savings budget with one real outflow (money moved to the saver) this
  // cycle. It must read as "set aside $X of $439" — NOT a sinking-fund balance —
  // so reserveBalance stays null and status never reads "over" even past 100%.
  const supabase = fakeSupabase({
    budgets: [{ id: "bs", monthly_target: 439, kind: "savings", category_id: "cs",
                categories: { id: "cs", name: "Savings Out", group: "Savings" } }],
    txns: [{ id: "ts", amount: -500, category_id: "cs", occurred_at: "2026-06-22T00:00:00", merchant: "Rabobank", description: "Savings Out", accounts: { type: "checking" } }],
    // reserveTxns is the since-start reserve query; savings must NOT appear there.
    reserveTxns: [],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Savings Out")!;
  expect(row.kind).toBe("savings");
  expect(row.netSpent).toBe(500);          // set aside this cycle (outflow)
  expect(row.pct).toBe(Math.round((500 / 439) * 100)); // 114% — exceeded the goal
  expect(row.reserveBalance).toBeNull();   // no notional accrual figure
  expect(row.projected).toBeNull();        // run-rate pacing is for monthly caps only
  expect(row.status).toBe("ok");           // exceeding a savings goal is success, not a breach
});

it("nets reimbursements against gross spend for a monthly_cap category", async () => {
  const supabase = fakeSupabase({
    budgets: [{ id: "b1", monthly_target: 800, kind: "monthly_cap", category_id: "c1",
                categories: { id: "c1", name: "Groceries", group: "Food" } }],
    txns: [
      { id: "t1", amount: -120, category_id: "c1", occurred_at: "2026-06-22T00:00:00", merchant: "PaknSave", description: null, accounts: { type: "checking" } },
      { id: "t2", amount: 20, category_id: "c1", occurred_at: "2026-06-23T00:00:00", merchant: "Refund", description: null, accounts: { type: "checking" } },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Groceries")!;
  expect(row.target).toBe(800);
  expect(row.netSpent).toBe(100);
  expect(row.reimbursed).toBe(20);
  expect(row.remaining).toBe(700);
  expect(row.status).toBe("ok");
});

it("treats a credit_card debit (negative amount) as outflow, like every account type", async () => {
  // Akahu signs debits negative on all account types, including liabilities.
  const supabase = fakeSupabase({
    budgets: [{ id: "b2", monthly_target: 200, kind: "monthly_cap", category_id: "c2",
                categories: { id: "c2", name: "Dining", group: "Discretionary" } }],
    txns: [{ id: "t3", amount: -50, category_id: "c2", occurred_at: "2026-06-21T00:00:00", merchant: "Cafe", description: null, accounts: { type: "credit_card" } }],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  expect(r.rows.find((x) => x.category === "Dining")!.netSpent).toBe(50);
});

it("ap_amortised counts gross outflow, ignoring the transfer's inflow leg", async () => {
  // A mortgage repayment: cash out of the cheque account (debit, -700) plus the
  // matching credit landing on the loan side (+700). Net would be $0; gross is 700.
  const supabase = fakeSupabase({
    budgets: [{ id: "b3", monthly_target: 700, kind: "ap_amortised", category_id: "c3",
                categories: { id: "c3", name: "Mortgage P&I", group: "Mortgage" } }],
    txns: [
      { id: "t4", amount: -700, category_id: "c3", occurred_at: "2026-06-21T00:00:00", merchant: "Loan", description: null, accounts: { type: "checking" } },
      { id: "t5", amount: 700, category_id: "c3", occurred_at: "2026-06-21T00:00:00", merchant: "Loan", description: null, accounts: { type: "mortgage" } },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Mortgage P&I")!;
  expect(row.effectiveSpend).toBe(700);
  expect(row.remaining).toBe(0);
  expect(row.status).toBe("warning"); // exactly 100% → warning band (>=80), not "over"
});

it("RAG 'over' threshold is strictly greater than 100%", async () => {
  function oneCap(spendAmount: number) {
    return fakeSupabase({
      budgets: [{ id: "b4", monthly_target: 100, kind: "monthly_cap", category_id: "c4",
                  categories: { id: "c4", name: "Coffee", group: "Discretionary" } }],
      txns: [{ id: "t6", amount: spendAmount, category_id: "c4", occurred_at: "2026-06-21T00:00:00", merchant: "Cafe", description: null, accounts: { type: "checking" } }],
      uncatCount: 0,
    });
  }
  const at = await computeBudgets({ supabase: oneCap(-100), householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  expect(at.rows[0].status).toBe("warning"); // exactly 100% → not over
  const over = await computeBudgets({ supabase: oneCap(-101), householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  expect(over.rows[0].status).toBe("over");
});

it("computes a position: income in vs expenses out for the period", async () => {
  const supabase = fakeSupabase({
    budgets: [{ id: "b1", monthly_target: 800, kind: "monthly_cap", category_id: "c1",
                categories: { id: "c1", name: "Groceries", group: "Food" } }],
    categories: [
      { id: "c1", kind: "monthly_cap", group: "Food" },
      { id: "inc", kind: "income", group: "Income" },
    ],
    txns: [
      { id: "t1", amount: 3000, category_id: "inc", occurred_at: "2026-06-25T00:00:00", merchant: "Salary", description: null, accounts: { type: "checking" } },
      { id: "t2", amount: -120, category_id: "c1", occurred_at: "2026-06-22T00:00:00", merchant: "PaknSave", description: null, accounts: { type: "checking" } },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  expect(r.position.income.actual).toBe(3000);
  expect(r.position.expenses.actual).toBe(120);
  expect(r.position.expenses.budget).toBe(800);
  expect(r.position.net.actual).toBe(2880);
});

it("flex allowance pro-rates the current cycle so the spend and allowance windows match", async () => {
  // Spend spans 3 completed cycles ($250) plus the in-progress cycle ($40). The
  // allowance must cover the same span: 3 full cycles + the elapsed fraction of
  // the current one — otherwise current-cycle spend is charged with no allowance.
  const supabase = fakeSupabase({
    budgets: [{ id: "b5", monthly_target: 100, kind: "monthly_cap", category_id: "c5",
                categories: { id: "c5", name: "Misc", group: "Discretionary" } }],
    txns: [
      { id: "p1", amount: -250, category_id: "c5", occurred_at: "2026-04-10T00:00:00", merchant: "X", description: null, accounts: { type: "checking" } },
      { id: "p2", amount: -40, category_id: "c5", occurred_at: "2026-06-25T00:00:00", merchant: "Y", description: null, accounts: { type: "checking" } },
    ],
    uncatCount: 0,
  });
  const now = new Date("2026-07-05T00:00:00");
  const r = await computeBudgets({ supabase, householdId: "h1", period, now });
  const { periodLength, dayOfPeriod } = periodProgress(period.start, period.end, now);
  const fraction = dayOfPeriod / periodLength;
  const expected = 100 * (3 + fraction) - (250 + 40);
  expect(r.flex.amount).toBeCloseTo(expected, 5);
  expect(r.flex.categoriesIncluded).toBe(1);
});

// ── Cents-rounding fix (P2-6) ─────────────────────────────────────────────────

it("a tiny negative float outflow (-0.0000001) is treated as zero spend, not a refund", async () => {
  // The DB stores numeric(14,2) so a real transaction is always a whole cent.
  // But floating-point arithmetic can produce residuals like -0.0000001.
  // Without rounding, -Number(-(-0.0000001)) = -0.0000001 < 0, making the code
  // classify it as a reimbursement and incorrectly inflate currentReimb.
  const supabase = fakeSupabase({
    budgets: [{ id: "b7", monthly_target: 200, kind: "monthly_cap", category_id: "c7",
                categories: { id: "c7", name: "Fuel", group: "Transport" } }],
    // amount: 0.0000001 → outflow = -0.0000001; with rounding → toCents = 0.
    txns: [
      { id: "t7a", amount: -50, category_id: "c7", occurred_at: "2026-06-22T00:00:00", merchant: "Z Energy", description: null, accounts: { type: "checking" } },
      { id: "t7b", amount: 0.0000001, category_id: "c7", occurred_at: "2026-06-22T00:00:00", merchant: "FP residual", description: null, accounts: { type: "checking" } },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Fuel")!;
  // The floating-point residual rounds to $0 — it must not appear as a reimbursement.
  expect(row.reimbursed).toBe(0);
  expect(row.spent).toBe(50);
  expect(row.netSpent).toBe(50);
});

it("a tiny positive float amount (0.0000001) is treated as zero spend, not outflow", async () => {
  // Symmetric case: a residual that should be zero but comes in as a tiny debit.
  const supabase = fakeSupabase({
    budgets: [{ id: "b8", monthly_target: 200, kind: "monthly_cap", category_id: "c8",
                categories: { id: "c8", name: "Parking", group: "Transport" } }],
    txns: [
      { id: "t8", amount: -0.0000001, category_id: "c8", occurred_at: "2026-06-22T00:00:00", merchant: "Residual", description: null, accounts: { type: "checking" } },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Parking")!;
  // Tiny debit rounds to zero: spent must be $0, not a sub-cent amount.
  expect(row.spent).toBe(0);
  expect(row.netSpent).toBe(0);
});

it("a genuine $0.01 refund still offsets spend after rounding", async () => {
  // Confirm rounding doesn't swallow legitimate one-cent refunds.
  const supabase = fakeSupabase({
    budgets: [{ id: "b9", monthly_target: 100, kind: "monthly_cap", category_id: "c9",
                categories: { id: "c9", name: "Coffee", group: "Discretionary" } }],
    txns: [
      { id: "t9a", amount: -10.00, category_id: "c9", occurred_at: "2026-06-22T00:00:00", merchant: "Cafe", description: null, accounts: { type: "checking" } },
      { id: "t9b", amount: 0.01, category_id: "c9", occurred_at: "2026-06-23T00:00:00", merchant: "Refund", description: null, accounts: { type: "checking" } },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
  const row = r.rows.find((x) => x.category === "Coffee")!;
  expect(row.spent).toBe(10.00);
  expect(row.reimbursed).toBe(0.01);
  expect(row.netSpent).toBeCloseTo(9.99, 5);
});

it("folds current-cycle pending (unsettled) outflow into the position projection, netting refunds", async () => {
  // Two pending card charges (-56.97 Liquorland, -62.33 Bunnings) and a pending
  // +60 auth reversal → net pending outflow = 59.30. It must lift the position's
  // projected/pending figures without touching the audited settled `actual`.
  const supabase = fakeSupabase({
    budgets: [{ id: "b1", monthly_target: 800, kind: "monthly_cap", category_id: "c1",
                categories: { id: "c1", name: "Groceries", group: "Food" } }],
    txns: [
      { id: "t1", amount: -120, category_id: "c1", occurred_at: "2026-06-22T00:00:00", merchant: "PAK", description: null, accounts: { type: "checking" } },
    ],
    categories: [{ id: "c1", kind: "monthly_cap", group: "Food", name: "Groceries" }],
    pendingTxns: [
      { amount: -56.97, occurred_at: "2026-06-26T00:00:00", description: "LIQUORLAND WESTCITY 524651 2685" },
      { amount: -62.33, occurred_at: "2026-06-26T00:00:00", description: "BUNNINGS - 9502 524651 2685" },
      { amount: 60.0, occurred_at: "2026-06-26T00:00:00", description: "CREDIT AUTH 524651 2685" }, // auth reversal offsets
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-26T00:00:00") });
  expect(r.position.expenses.pending).toBeCloseTo(59.30, 5);
  // Settled "Out" is untouched.
  expect(r.position.expenses.actual).toBe(120);
  const gro = r.rows.find((x) => x.category === "Groceries")!;
  expect(gro.spent).toBe(120);
});

it("attributes pending to the right budget via the rules, leaving the remainder unallocated", async () => {
  // The canary: a pending -56.97 LIQUORLAND WESTCITY charge. The settled-trained
  // `merchant exact: Liquorland` rule matches it via the description prefix, so it
  // lands on the Alcohol budget — answering "can I spend on beer right now?".
  // The +60 auth reversal matches nothing → unallocated (floored at 0 net here).
  const supabase = fakeSupabase({
    budgets: [
      { id: "ba", monthly_target: 89.89, kind: "monthly_cap", category_id: "alc",
        categories: { id: "alc", name: "Alcohol", group: "Discretionary" } },
      { id: "bg", monthly_target: 1700, kind: "monthly_cap", category_id: "gro",
        categories: { id: "gro", name: "Groceries", group: "Food" } },
    ],
    categories: [
      { id: "alc", kind: "monthly_cap", group: "Discretionary", name: "Alcohol" },
      { id: "gro", kind: "monthly_cap", group: "Food", name: "Groceries" },
    ],
    rules: [
      { id: "r1", category_id: "alc", match_type: "exact", match_value: "Liquorland", field: "merchant", priority: 50 },
    ],
    txns: [],
    pendingTxns: [
      { amount: -56.97, occurred_at: "2026-06-26T00:00:00", description: "LIQUORLAND WESTCITY 524651 2685 05/06 13:46" },
      { amount: 60.0, occurred_at: "2026-06-26T00:00:00", description: "CREDIT AUTH 524651 2685 06/06" },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-26T00:00:00") });
  const alc = r.rows.find((x) => x.category === "Alcohol")!;
  expect(alc.pendingSpent).toBeCloseTo(56.97, 5);
  expect(alc.spent).toBe(0); // settled audited figure untouched
  const gro = r.rows.find((x) => x.category === "Groceries")!;
  expect(gro.pendingSpent).toBe(0);
  // +60 reversal matched no rule → unallocated, but net is negative so floored to 0.
  expect(r.unallocatedPending).toBe(0);
});

it("floors net pending at 0 when refunds exceed charges (no negative 'spend')", async () => {
  const supabase = fakeSupabase({
    budgets: [],
    txns: [],
    pendingTxns: [
      { amount: -10, occurred_at: "2026-06-26T00:00:00" },
      { amount: 50, occurred_at: "2026-06-26T00:00:00" },
    ],
    uncatCount: 0,
  });
  const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-26T00:00:00") });
  expect(r.position.expenses.pending).toBe(0);
});

// ── Reserve buffer contributions (Task 4) ─────────────────────────────────────

describe("reserve buffer contributions", () => {
  // Setup: Home Improvement reserve, $50/mo, same period as above (Jun–Jul cycle,
  // now=2026-06-25). accrual ≈ 260, spend since start = 1996 → raw balance ≈ -1736.
  // The buffer account holds a +340 inflow this cycle → credited to the shortfall.
  it("credits a behind reserve from buffer inflows (largest shortfall first)", async () => {
    const supabase = fakeSupabase({
      budgets: [{ id: "bhi", monthly_target: 50, kind: "reserve", category_id: "chi",
                  categories: { id: "chi", name: "Home Improvement", group: "Home" } }],
      txns: [],
      reserveTxns: [
        { id: "r1", amount: -1996, category_id: "chi", occurred_at: "2026-02-10T00:00:00" },
      ],
      uncatCount: 0,
      bufferAccount: { id: "buf-acct", balance_current: 5000, is_reserve_buffer: true },
      // One inflow of $340 during the cycle (after 2026-06-20) — is_reserve_buffer
      // account receives contributions from the owner's manual top-ups.
      bufferTxns: [
        { amount: 340, occurred_at: "2026-06-21T00:00:00" },
      ],
    });
    const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
    const row = r.rows.find((x) => x.category === "Home Improvement")!;
    // Raw balance ≈ -1736; after crediting $340 → ≈ -1396.
    expect(row.reserveBalance).toBeCloseTo(-1396, 0);
    expect(r.reserveBuffer.contributions).toBe(340);
    expect(r.reserveBuffer.sweptThisCycle).toBe(340);
    expect(r.reserveBuffer.accountId).toBe("buf-acct");
  });

  it("ignores buffer outflows (drawdowns) — reserveBalance stays at raw value", async () => {
    const supabase = fakeSupabase({
      budgets: [{ id: "bhi2", monthly_target: 50, kind: "reserve", category_id: "chi2",
                  categories: { id: "chi2", name: "Home Improvement", group: "Home" } }],
      txns: [],
      reserveTxns: [
        { id: "r2", amount: -1996, category_id: "chi2", occurred_at: "2026-02-10T00:00:00" },
      ],
      uncatCount: 0,
      bufferAccount: { id: "buf-acct", balance_current: 5000, is_reserve_buffer: true },
      // A real drawdown (negative amount). sumContributions drops it, so the
      // reserve must NOT be reduced again — the cost already hit category spend.
      bufferTxns: [{ amount: -340, occurred_at: "2026-06-22T00:00:00" }],
    });
    const r = await computeBudgets({ supabase, householdId: "h1", period, now: new Date("2026-06-25T00:00:00") });
    const row = r.rows.find((x) => x.category === "Home Improvement")!;
    // No inflows → no credit → raw balance ≈ -1736.
    expect(row.reserveBalance).toBeCloseTo(-1736, 0);
    expect(r.reserveBuffer.contributions).toBe(0);
    expect(r.reserveBuffer.sweptThisCycle).toBe(0);
  });
});
