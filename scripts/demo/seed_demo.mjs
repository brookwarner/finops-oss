#!/usr/bin/env node
// Seed a demo household with realistic synthetic data.
//
// Idempotent: every write upserts on a natural key, so re-running refreshes the
// data without duplicating. Talks to whatever Supabase project the env points at
// using the SERVICE ROLE key (bypasses RLS). Intended for a THROWAWAY demo DB —
// never point this at production.
//
// Required env (sourced from .env.demo.local by up.sh):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional:
//   DEMO_EMAIL (default demo@finops.local), DEMO_PASSWORD (default demo-finops-123)

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.DEMO_EMAIL || "demo@finops.local";
const PASSWORD = process.env.DEMO_PASSWORD || "demo-finops-123";

if (!URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (/supabase\.co/.test(URL) && !process.env.DEMO_ALLOW_REMOTE) {
  console.error(
    `Refusing to seed a hosted Supabase project (${URL}).\n` +
      "This script writes synthetic data + a demo user. Set DEMO_ALLOW_REMOTE=1 only " +
      "if this is a dedicated throwaway demo project (NEVER production).",
  );
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

// Deterministic PRNG so the demo looks the same every run.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260617);
const rand = (min, max) => min + rng() * (max - min);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const money = (n) => Math.round(n * 100) / 100;

function check(label, error) {
  if (error) {
    console.error(`✗ ${label}:`, error.message || error);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// 1. Demo auth user → household (via the bootstrap trigger)
// ---------------------------------------------------------------------------
async function ensureUserAndHousehold() {
  // The signup_allowlist trigger rejects any email not in the table.
  const { error: alErr } = await db
    .from("signup_allowlist")
    .upsert({ email: EMAIL, note: "demo" }, { onConflict: "email" });
  check("allowlist demo email", alErr);

  // Create the user (fires bootstrap_household_for_user). Tolerate re-runs.
  let userId;
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (cErr && !/already.*registered|already.*exists/i.test(cErr.message)) {
    check("create demo user", cErr);
  }
  if (created?.user) {
    userId = created.user.id;
  } else {
    // Already exists — find them.
    const { data: list, error: lErr } = await db.auth.admin.listUsers({ perPage: 200 });
    check("list users", lErr);
    const u = list.users.find((x) => x.email?.toLowerCase() === EMAIL.toLowerCase());
    if (!u) check("locate existing demo user", { message: "not found" });
    userId = u.id;
  }

  const { data: mem, error: mErr } = await db
    .from("household_members")
    .select("household_id")
    .eq("user_id", userId)
    .single();
  check("resolve household", mErr);
  return { userId, householdId: mem.household_id };
}

// ---------------------------------------------------------------------------
// 2. Categories + budgets (generic taxonomy, mirrors oss overlay 0014)
// ---------------------------------------------------------------------------
// [name, group, kind, context, monthlyTarget|null]
const TAXONOMY = [
  ["Salary", "Income", "income", "personal", null],
  ["Other Income", "Income", "income", "personal", null],
  ["Interest Income", "Income", "income", "personal", null],
  ["Groceries", "Food", "monthly_cap", "personal", 1100],
  ["Restaurants/Dining/Snacks", "Food", "monthly_cap", "personal", 300],
  ["Entertainment", "Discretionary", "monthly_cap", "personal", 80],
  ["Hobbies", "Discretionary", "monthly_cap", "personal", 120],
  ["Date Nights", "Discretionary", "monthly_cap", "personal", 100],
  ["Clothing/Shoes", "Discretionary", "reserve", "personal", 80],
  ["General Merchandise", "Discretionary", "monthly_cap", "personal", 120],
  ["Online Services", "Discretionary", "monthly_cap", "personal", 90],
  ["Gifts", "Discretionary", "reserve", "personal", 50],
  ["Holidays", "Discretionary", "reserve", "personal", 200],
  ["Healthcare/Medical", "Wellbeing", "reserve", "personal", 100],
  ["Pets/Pet Care", "Wellbeing", "monthly_cap", "personal", 90],
  ["Haircuts", "Wellbeing", "reserve", "personal", 50],
  ["Gasoline/Fuel", "Transit", "monthly_cap", "personal", 320],
  ["Public Transport", "Transit", "monthly_cap", "personal", 40],
  ["Home Maintenance", "Maintenance", "reserve", "personal", 100],
  ["Power", "Utilities", "ap_amortised", "personal", 220],
  ["Water", "Utilities", "ap_amortised", "personal", 40],
  ["Telephone Services", "Utilities", "ap_amortised", "personal", 110],
  ["Rates", "Utilities", "ap_amortised", "personal", 260],
  ["Insurance", "Fixed", "ap_amortised", "personal", 240],
  ["Mortgage Interest", "Mortgage", "ap_amortised", "personal", 1900],
  ["Mortgage Part 1", "Mortgage", "ap_amortised", "personal", 900],
  ["Investments", "Investments", "reserve", "personal", 300],
  ["Savings Out", "Savings", "reserve", "personal", 400],
  ["Transfers", "System", "transfer", "personal", null],
];

const INCOME_TARGET = {
  Salary: 7800,
  "Other Income": 150,
  "Interest Income": 40,
};

async function seedTaxonomy(hh) {
  // Upsert categories.
  const catRows = TAXONOMY.map(([name, group, kind, context]) => ({
    household_id: hh,
    name,
    group,
    kind,
    context,
  }));
  const { error: cErr } = await db
    .from("categories")
    .upsert(catRows, { onConflict: "household_id,name" });
  check("upsert categories", cErr);

  const { data: cats, error: gErr } = await db
    .from("categories")
    .select("id,name,kind")
    .eq("household_id", hh);
  check("fetch categories", gErr);
  const byName = new Map(cats.map((c) => [c.name, c]));

  // Budgets: cap/reserve/ap_amortised get monthly_target; income gets a target too.
  const budgetRows = [];
  for (const [name, , kind, , target] of TAXONOMY) {
    const cat = byName.get(name);
    if (!cat) continue;
    if (["monthly_cap", "reserve", "ap_amortised"].includes(kind) && target != null) {
      budgetRows.push({ household_id: hh, category_id: cat.id, kind, monthly_target: target });
    }
    if (kind === "income" && INCOME_TARGET[name] != null) {
      budgetRows.push({
        household_id: hh,
        category_id: cat.id,
        kind: "income",
        monthly_target: INCOME_TARGET[name],
      });
    }
  }
  const { error: bErr } = await db
    .from("budgets")
    .upsert(budgetRows, { onConflict: "household_id,category_id" });
  check("upsert budgets", bErr);

  return byName;
}

// ---------------------------------------------------------------------------
// 3. Accounts
// ---------------------------------------------------------------------------
async function seedAccounts(hh) {
  const now = new Date().toISOString();
  const rows = [
    { key: "demo_acc_checking", name: "Everyday", institution: "Westpac", type: "checking", balance_current: 2180.55, balance_available: 2180.55 },
    { key: "demo_acc_savings", name: "Bonus Saver", institution: "Westpac", type: "savings", balance_current: 4820.0, balance_available: 4820.0 },
    { key: "demo_acc_mortgage", name: "Choices Home Loan", institution: "Westpac", type: "mortgage", balance_current: -518400.0, balance_available: null },
    { key: "demo_acc_invest", name: "Investments", institution: "Sharesies", type: "investment", balance_current: 43120.0, balance_available: null },
    // Manual home asset (manual_-prefixed convention, sync-safe) so net worth nets
    // positive against the mortgage instead of showing a large negative.
    { key: "manual_home", name: "12 Example Street", institution: "Manual", type: "other", balance_current: 865000.0, balance_available: null },
  ];
  const insert = rows.map((r) => ({
    household_id: hh,
    akahu_account_id: r.key,
    name: r.name,
    institution: r.institution,
    type: r.type,
    currency: "NZD",
    balance_current: r.balance_current,
    balance_available: r.balance_available,
    refreshed_balance_at: now,
  }));
  const { error } = await db.from("accounts").upsert(insert, { onConflict: "akahu_account_id" });
  check("upsert accounts", error);

  const { data, error: gErr } = await db
    .from("accounts")
    .select("id,akahu_account_id")
    .eq("household_id", hh);
  check("fetch accounts", gErr);
  const byKey = new Map(data.map((a) => [a.akahu_account_id, a.id]));
  return byKey;
}

// ---------------------------------------------------------------------------
// 4. Transactions — ~6 months of realistic NZ activity
// ---------------------------------------------------------------------------
const DAY = 86400000;
function atNoonUTC(d) {
  const x = new Date(d);
  x.setUTCHours(12, 0, 0, 0);
  return x.toISOString();
}

async function seedTransactions(hh, accounts, cats) {
  const checking = accounts.get("demo_acc_checking");
  // Transaction ids are positional, so a reseed must start from a clean slate.
  const { error: delErr } = await db.from("transactions").delete().eq("household_id", hh);
  check("clear prior transactions", delErr);
  const today = new Date();
  const START = new Date(today.getTime() - 183 * DAY);
  const txns = [];
  let n = 0;
  const id = () => `demo_txn_${String(n++).padStart(5, "0")}`;
  const catId = (name) => cats.get(name)?.id ?? null;

  const add = (date, amount, merchant, catName, accountId = checking, desc = null) => {
    txns.push({
      household_id: hh,
      account_id: accountId,
      akahu_transaction_id: id(),
      occurred_at: atNoonUTC(date),
      amount: money(amount),
      merchant,
      description: desc ?? merchant,
      category_id: catId(catName),
      is_manual_category: true,
      akahu_type: amount >= 0 ? "CREDIT" : "DEBIT",
      raw: {},
    });
  };

  const dayDate = (y, m, d) => new Date(Date.UTC(y, m, d));
  const pickDays = (k, maxDay) => {
    const s = new Set();
    let guard = 0;
    while (s.size < k && guard++ < 300) s.add(1 + Math.floor(rng() * maxDay));
    return [...s];
  };

  // Fixed monthly bills (one charge each, near the start of the month). Each is
  // an outflow; mortgage parts post against the mortgage account.
  const mortgage = accounts.get("demo_acc_mortgage");
  const FIXED = [
    { cat: "Mortgage Interest", amt: 1900, day: 2, merchant: "Westpac Home Loan Interest", acct: mortgage },
    { cat: "Mortgage Part 1", amt: 900, day: 2, merchant: "Westpac Home Loan Principal", acct: mortgage },
    { cat: "Power", amt: 215, day: 3, merchant: "Genesis Energy" },
    { cat: "Water", amt: 40, day: 3, merchant: "Watercare" },
    { cat: "Telephone Services", amt: 105, day: 4, merchant: "One NZ" },
    { cat: "Rates", amt: 255, day: 5, merchant: "Auckland Council" },
    { cat: "Insurance", amt: 235, day: 6, merchant: "AA Insurance" },
    { cat: "Savings Out", amt: 400, day: 7, merchant: "Transfer to Bonus Saver" },
    { cat: "Investments", amt: 300, day: 9, merchant: "Sharesies" },
  ];
  // Subscriptions → Online Services (drives the subscription radar).
  const SUBS = [
    { amt: 19.99, day: 8, merchant: "Netflix" },
    { amt: 17.99, day: 12, merchant: "Spotify" },
    { amt: 12.99, day: 18, merchant: "Disney+" },
    { amt: 16.99, day: 22, merchant: "Audible" },
    { amt: 9.99, day: 26, merchant: "iCloud+" },
  ];
  // Variable spend: `count` charges/month summing to roughly `monthly`.
  const VARIABLE = [
    { cat: "Groceries", monthly: 1050, count: 9, merch: ["Countdown", "New World", "PAK'nSAVE", "Woolworths NZ", "New World Metro"] },
    { cat: "Restaurants/Dining/Snacks", monthly: 285, count: 6, merch: ["Hell Pizza", "Mexicali Fresh", "BurgerFuel", "Sal's Pizza", "Columbus Coffee", "Wendy's", "Sushi Time"] },
    { cat: "Gasoline/Fuel", monthly: 310, count: 4, merch: ["Z Energy", "BP Connect", "Mobil", "Gull"] },
    { cat: "Entertainment", monthly: 75, count: 2, merch: ["Event Cinemas", "Steam", "PlayStation Store"] },
    { cat: "Hobbies", monthly: 110, count: 2, merch: ["Mighty Ape", "Spotlight", "The Bike Shop"] },
    { cat: "General Merchandise", monthly: 115, count: 3, merch: ["The Warehouse", "Kmart", "Briscoes"] },
    { cat: "Public Transport", monthly: 38, count: 2, merch: ["AT HOP", "Uber"] },
    { cat: "Pets/Pet Care", monthly: 85, count: 2, merch: ["Animates", "Vetcare"] },
  ];
  // Lumpy / occasional spend: appears some months, one larger charge when it does.
  const OCCASIONAL = [
    { cat: "Date Nights", monthly: 95, prob: 0.8, merch: ["The Grove", "Cazador", "Amano"] },
    { cat: "Clothing/Shoes", monthly: 80, prob: 0.6, merch: ["Cotton On", "Hallenstein", "Glassons", "Barkers"] },
    { cat: "Gifts", monthly: 50, prob: 0.5, merch: ["Mecca", "Whitcoulls", "Smiggle"] },
    { cat: "Holidays", monthly: 200, prob: 0.35, merch: ["Air New Zealand", "Booking.com", "Jucy Rentals"] },
    { cat: "Healthcare/Medical", monthly: 95, prob: 0.6, merch: ["Unichem Pharmacy", "City Medical", "Specsavers"] },
    { cat: "Haircuts", monthly: 48, prob: 0.7, merch: ["Just Cuts", "Rodney Wayne"] },
    { cat: "Home Maintenance", monthly: 95, prob: 0.4, merch: ["Mitre 10", "Bunnings", "Auckland Plumbing Co"] },
  ];

  // Walk the last 6 calendar months (current month is partial, up to today).
  const startMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  for (let mi = 0; mi < 6; mi++) {
    const Y = startMonth.getUTCFullYear();
    const M = startMonth.getUTCMonth() + mi;
    const md = new Date(Date.UTC(Y, M, 1));
    const yy = md.getUTCFullYear();
    const mm = md.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    const isCurrent = yy === today.getUTCFullYear() && mm === today.getUTCMonth();
    const maxDay = isCurrent ? today.getUTCDate() : daysInMonth;
    if (maxDay < 1) continue;

    for (const f of FIXED) {
      if (f.day <= maxDay) add(dayDate(yy, mm, f.day), -money(f.amt * (0.97 + 0.06 * rng())), f.merchant, f.cat, f.acct || checking);
    }
    for (const s of SUBS) {
      if (s.day <= maxDay) add(dayDate(yy, mm, s.day), -s.amt, s.merchant, "Online Services");
    }
    for (const v of VARIABLE) {
      for (const d of pickDays(v.count, maxDay)) {
        add(dayDate(yy, mm, d), -money((v.monthly / v.count) * (0.8 + 0.4 * rng())), pick(v.merch), v.cat);
      }
    }
    for (const o of OCCASIONAL) {
      if (rng() < o.prob) {
        const d = 1 + Math.floor(rng() * maxDay);
        add(dayDate(yy, mm, d), -money((o.monthly / o.prob) * (0.85 + 0.3 * rng())), pick(o.merch), o.cat);
      }
    }
  }

  // Fortnightly salary on Thursdays (~$7,800/mo net) — the income side.
  for (let d = new Date(START); d <= today; d = new Date(d.getTime() + DAY)) {
    if (d.getUTCDay() === 4 && Math.floor((d - START) / DAY / 7) % 2 === 0) {
      add(d, rand(3560, 3740), "Payroll — Northbridge Ltd", "Salary");
    }
  }

  // One grocery refund to demonstrate refund netting.
  add(new Date(today.getTime() - 12 * DAY), 24.5, "Countdown — refund", "Groceries", checking, "Returned item refund");

  // Upsert in batches.
  for (let i = 0; i < txns.length; i += 500) {
    const batch = txns.slice(i, i + 500);
    const { error } = await db
      .from("transactions")
      .upsert(batch, { onConflict: "akahu_transaction_id" });
    check(`upsert transactions [${i}]`, error);
  }
  return txns.length;
}

// ---------------------------------------------------------------------------
// 5. Holdings (investment account)
// ---------------------------------------------------------------------------
async function seedHoldings(hh, accounts) {
  const acc = accounts.get("demo_acc_invest");
  const funds = [
    { fund_id: "nz_top50", symbol: "FNZ", name: "NZ Top 50", value: 14800, returns: 2100 },
    { fund_id: "us500", symbol: "USF", name: "US 500", value: 19200, returns: 4300 },
    { fund_id: "global_bond", symbol: "GBF", name: "Global Bond Fund", value: 9120, returns: 410 },
  ];
  const rows = funds.map((f) => ({
    household_id: hh,
    account_id: acc,
    fund_id: f.fund_id,
    symbol: f.symbol,
    name: f.name,
    logo: null,
    currency: "NZD",
    shares: money(f.value / 3.2),
    value: f.value,
    returns: f.returns,
    cost_basis: f.value - f.returns,
  }));
  const { error } = await db.from("holdings").upsert(rows, { onConflict: "account_id,fund_id" });
  check("upsert holdings", error);
}

// ---------------------------------------------------------------------------
// 6. Net-worth snapshots (weekly, gently rising)
// ---------------------------------------------------------------------------
async function seedNetWorth(hh) {
  const today = new Date();
  const rows = [];
  for (let w = 26; w >= 0; w--) {
    const d = new Date(today.getTime() - w * 7 * DAY);
    const t = (26 - w) / 26; // 0..1 progress
    const checking = 1800 + 600 * rng();
    const savings = 4000 + 1200 * t;
    const invest = 36000 + 8000 * t + 1500 * Math.sin(w);
    const home = 865000; // manual home asset (steady)
    const mortgage = -(523000 - 5000 * t); // principal slowly falling
    const assets = money(checking + savings + invest + home);
    const liabilities = money(-mortgage);
    rows.push({
      household_id: hh,
      snapshot_date: d.toISOString().slice(0, 10),
      assets,
      liabilities,
      net: money(assets - liabilities),
      breakdown: [
        { account: "Everyday", value: money(checking) },
        { account: "Bonus Saver", value: money(savings) },
        { account: "Investments", value: money(invest) },
        { account: "12 Example Street", value: home },
        { account: "Choices Home Loan", value: money(mortgage) },
      ],
    });
  }
  const { error } = await db
    .from("net_worth_snapshots")
    .upsert(rows, { onConflict: "household_id,snapshot_date" });
  check("upsert net_worth_snapshots", error);
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`Seeding demo data into ${URL}`);
  const { householdId } = await ensureUserAndHousehold();
  console.log(`✓ demo user ${EMAIL} → household ${householdId}`);
  const cats = await seedTaxonomy(householdId);
  console.log(`✓ ${cats.size} categories + budgets`);
  const accounts = await seedAccounts(householdId);
  console.log(`✓ ${accounts.size} accounts`);
  const txCount = await seedTransactions(householdId, accounts, cats);
  console.log(`✓ ${txCount} transactions`);
  await seedHoldings(householdId, accounts);
  console.log(`✓ holdings`);
  await seedNetWorth(householdId);
  console.log(`✓ net-worth snapshots`);
  console.log(`\nDone. Log in at /login as ${EMAIL} (password: ${PASSWORD}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
