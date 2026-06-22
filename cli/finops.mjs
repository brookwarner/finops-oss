#!/usr/bin/env node
// finops — token-efficient CLI for the FinOps API.
//
// A thin client over the same /api/* routes the PWA and MCP use. Auth is a
// personal access token (fops_…) minted at Settings → Tokens in the PWA.
//
// Config resolution (first match wins):
//   env FINOPS_TOKEN / FINOPS_API_URL
//   ~/.config/finops/config.json  { "token": "...", "apiUrl": "..." }
// Default apiUrl: https://finops.example.com
//
// Commands:
//   finops budget [category]   budgets for the current cycle, or one category
//   finops review [--limit N]  transactions awaiting categorisation
//   finops net-worth           assets − liabilities
//   finops investments         holdings by account + cumulative & annualised growth
//   finops invest-since <account> <date>  set the investing-since date for annualised growth
//   finops forecast            will I make it to payday? cash runway
//   finops mortgage            interest vs principal YTD + mortgage-free estimate
//   finops subs                recurring subscriptions: monthly/annual cost + next charge
//   finops burn                daily burn pace this cycle: actual $/day vs plan, trending up/down
//   finops login <token> [url] save a token to the config file
//   finops help

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { budgetLine, budgetSentence, reviewLine, money, mortgageLines, budgetHistoryLines, budgetSetLine, categoriseResultLine, subsLines, fiLines, repaymentFILines, bufferLines, positionLine, investmentsLines, plannedNetLine, incomeHistoryLines, burnLines, cashflowLines, assetLines } from "./lib/format.mjs";

const DEFAULT_URL = "https://finops.example.com";
const CONFIG_PATH = join(homedir(), ".config", "finops", "config.json");

function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    /* no config file yet */
  }
  return {
    token: process.env.FINOPS_TOKEN || file.token || "",
    apiUrl: (process.env.FINOPS_API_URL || file.apiUrl || DEFAULT_URL).replace(/\/$/, ""),
  };
}

function saveConfig(cfg) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

function die(msg, code = 1) {
  process.stderr.write(msg.replace(/\n?$/, "\n"));
  process.exit(code);
}

async function api(path, cfg) {
  if (!cfg.token) {
    die("No token. Run `finops login <fops_…>` or set FINOPS_TOKEN.\nMint one in the PWA: Settings → Tokens.");
  }
  let res;
  try {
    res = await fetch(cfg.apiUrl + path, {
      headers: { authorization: `Bearer ${cfg.token}`, accept: "application/json" },
    });
  } catch (e) {
    die(`Network error reaching ${cfg.apiUrl}: ${e.message}`);
  }
  if (res.status === 401) die("Unauthorized — token invalid or revoked.");
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error ?? "";
    } catch {
      /* non-JSON body */
    }
    die(`API ${res.status} on ${path}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

async function send(path, cfg, method, body) {
  if (!cfg.token) die("No token. Run `finops login <fops_…>` or set FINOPS_TOKEN.");
  let res;
  try {
    res = await fetch(cfg.apiUrl + path, {
      method,
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    die(`Network error reaching ${cfg.apiUrl}: ${e.message}`);
  }
  if (res.status === 401) die("Unauthorized — token invalid or revoked.");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const cand = Array.isArray(json.candidates) && json.candidates.length ? ` (did you mean: ${json.candidates.join(", ")})` : "";
    die(`API ${res.status} on ${path}${json.error ? `: ${json.error}` : ""}${cand}`);
  }
  return json;
}

// Resolve one or more id-prefixes to full transaction ids via the pending review set.
async function resolveTxnPrefixes(prefixes, cfg) {
  const data = await api(`/api/review?limit=200`, cfg);
  const ids = data.transactions.map((t) => t.id);
  return prefixes.map((p) => {
    const matches = ids.filter((id) => id.startsWith(p));
    if (matches.length === 0) die(`No pending transaction matches id "${p}".`);
    if (matches.length > 1) die(`Ambiguous id prefix "${p}" — give more characters.`);
    return matches[0];
  });
}

// Tiny flag parser: returns { _: [positional], flagName: value|true }.
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const HELP = `finops — personal finance from the terminal

Usage:
  finops budget [category]      Budget status for the current cycle, or one category
  finops review [--limit N]     Transactions awaiting categorisation review
  finops net-worth              Total assets minus liabilities
  finops investments            Holdings by account + cumulative & annualised (per-year) growth
  finops invest-since <account> <yyyy-mm-dd>    Set the investing-since date that seeds annualised growth
  finops forecast [--cut N] [--income $/wk] [--lump]   Cashflow game-plan: scenario zero-dates + next bills
  finops mortgage               Interest vs principal YTD + mortgage-free estimate
  finops categorise <id> [<id>...] <category>   Categorise pending transactions
  finops accept [<id>...]                       Accept pending suggestions (all, or given)
  finops apply-similar <merchant> <category>    Apply a category to all of a merchant's txns
  finops budget-set <category> <amount>         Set a category's monthly budget target
  finops fi                     FI: how close, projected FI age
  finops fi --extra <N> [--lump <N>]   Repayment→FI: does more on the mortgage reach FI sooner than investing it?
  finops income                 Per-cycle income: total vs plan (sparkline + history)
  finops burn                   Daily burn pace this cycle: actual $/day vs plan, trending up/down
  finops runway [--cut N] [--income $/wk] [--lump]   Alias for forecast
  finops subs                   Recurring subscriptions: monthly/annual cost + next charge
  finops buffer                 Emergency fund: balance vs N-months-of-essentials target
  finops asset                  Manual assets: list / set "<name>" <amt> / rm <id>
                                set: [--type other|investment|savings|receivable] [--id manual_x]
                                loan: [--loan --category "<cat>" --rate <pct> [--anchor-date YYYY-MM-DD]]
                                receivable: [--receivable --likelihood likely|uncertain --expected YYYY-MM-DD --pre-tax --tax-rate 0.39]
  finops login <token> [url]    Save a PAT (and optional API URL) to ${CONFIG_PATH}
  finops help

Options:
  --from <ISO>  --to <ISO>      Override the budget period (budget command)
  --group <name>                Filter budgets to one group
  --year <YYYY>                 Calendar year for the mortgage command
  --extra <N>  --lump <N>       Mortgage what-if: extra $/mo, one-off lump sum
  --refix <rate>                Mortgage what-if: refix rate (% p.a.) from fixed-until
  --history                     Per-cycle history for a category (budget command)
  --trailing <N>                Trailing-average window in days (burn command, default 7)
  --cut <N>  --income <$/wk>    Forecast what-if: cut spend %, extra weekly income
  --lump                        Forecast what-if: assume the owed lump lands now
  --json                        Raw JSON instead of formatted output

Config: FINOPS_TOKEN / FINOPS_API_URL env, or ${CONFIG_PATH}
Default API: ${DEFAULT_URL}`;

async function cmdBudget(args, cfg) {
  const category = args._[0];
  if (args.history) {
    if (!category) die("Pass a category: finops budget <category> --history");
    const hq = new URLSearchParams({ category });
    if (args.limit) hq.set("limit", String(args.limit));
    const hist = await api(`/api/budgets/history?${hq}`, cfg);
    if (args.json) return console.log(JSON.stringify(hist, null, 2));
    if (!hist.found) die(`No budget matching "${category}".`);
    console.log(budgetHistoryLines(hist.category, hist.series));
    return;
  }
  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  if (args.from) qs.set("from", args.from);
  if (args.to) qs.set("to", args.to);
  if (args.group) qs.set("group", args.group);
  const data = await api(`/api/budgets${qs.toString() ? `?${qs}` : ""}`, cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));

  if (category) {
    if (!data.found || !data.budget) die(`No budget matching "${category}".`);
    console.log(budgetSentence(data.budget, data.period.daysLeft));
    return;
  }

  const { period, flex, inbox, budgets, position } = data;
  console.log(
    `Cycle ${period.start.slice(0, 10)} → ${period.end.slice(0, 10)}  (${period.daysLeft}d left)`,
  );
  if (position) {
    console.log(positionLine(position));
    const pn = plannedNetLine(position);
    if (pn) console.log(pn);
  }
  for (const row of budgets) console.log("  " + budgetLine(row, period.daysLeft));
  console.log(
    `\nFlex ${money(flex.amount)} across ${flex.categoriesIncluded} caps  ·  ${inbox.inboxInWindow} to review`,
  );
}

async function cmdReview(args, cfg) {
  const qs = new URLSearchParams();
  if (args.limit) qs.set("limit", String(args.limit));
  const data = await api(`/api/review${qs.toString() ? `?${qs}` : ""}`, cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));

  if (!data.transactions.length) {
    console.log("Inbox zero — nothing to review.");
    return;
  }
  console.log(`${data.pending} awaiting review (showing ${data.transactions.length}):`);
  for (const t of data.transactions) console.log("  " + reviewLine(t));
}

async function cmdNetWorth(args, cfg) {
  const data = await api("/api/net-worth", cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  console.log(
    `Net worth ${money(data.net)}  =  assets ${money(data.assets)} − liabilities ${money(-data.liabilities)}`,
  );
  for (const a of data.accounts.sort((x, y) => x.balance - y.balance)) {
    console.log(`  ${money(a.balance).padStart(12)}  ${a.name} (${a.type})`);
  }
}

async function cmdInvestments(args, cfg) {
  const data = await api("/api/investments", cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  for (const line of investmentsLines(data)) console.log(line);
}

// finops invest-since <account-name> <yyyy-mm-dd>  — set the "investing since"
// date that seeds annualised growth. Resolves the account by name substring.
async function cmdInvestSince(args, cfg) {
  const [needle, date] = args._;
  if (!needle || !date) die("Usage: finops invest-since <account-name> <yyyy-mm-dd> (use 'none' to clear)");
  const data = await api("/api/investments", cfg);
  const q = needle.toLowerCase();
  const matches = (data.accounts ?? []).filter((g) => g.accountName.toLowerCase().includes(q));
  if (matches.length === 0) die(`No account matches "${needle}".`);
  if (matches.length > 1) die(`Ambiguous "${needle}" — matches: ${matches.map((m) => m.accountName).join(", ")}`);
  const body = { accountId: matches[0].accountId, date: date === "none" ? null : date };
  const result = await send("/api/investments/inception", cfg, "PATCH", body);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(result.date ? `Set ${result.account} investing-since to ${result.date}.` : `Cleared ${result.account} investing-since date.`);
}

async function cmdCashflow(args, cfg) {
  const qs = new URLSearchParams();
  if (args.cut != null) qs.set("cut", String(args.cut));
  if (args.income != null) qs.set("income", String(args.income));
  if (args.lump) qs.set("lump", "1");
  const path = `/api/cashflow${qs.toString() ? `?${qs}` : ""}`;
  const data = await api(path, cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  for (const line of cashflowLines(data)) console.log(line);
}

async function cmdMortgage(args, cfg) {
  const qs = new URLSearchParams();
  if (args.year) qs.set("year", String(args.year));
  if (args.extra) qs.set("extraMonthly", String(args.extra));
  if (args.lump) qs.set("lumpSum", String(args.lump));
  if (args.refix) qs.set("refixRate", String(args.refix));
  const data = await api(`/api/mortgage${qs.toString() ? `?${qs}` : ""}`, cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  if (!data.parts?.length) {
    console.log("No mortgage tranches found.");
    return;
  }
  for (const line of mortgageLines(data)) console.log(line);
}

async function cmdCategorise(args, cfg) {
  if (args._.length < 2) die('Usage: finops categorise <id-prefix> [<id-prefix>...] <category>');
  const category = args._[args._.length - 1];
  const prefixes = args._.slice(0, -1);
  const transactionIds = await resolveTxnPrefixes(prefixes, cfg);
  const result = await send("/api/transactions/categorise", cfg, "PATCH", { transactionIds, category });
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(categoriseResultLine(result));
}

async function cmdAccept(args, cfg) {
  const body = {};
  if (args._.length) body.transactionIds = await resolveTxnPrefixes(args._, cfg);
  const result = await send("/api/transactions/accept-suggestions", cfg, "POST", body);
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`accepted ${result.accepted}`);
}

async function cmdBudgetSet(args, cfg) {
  const category = args._[0];
  const amount = Number(args._[1]);
  if (!category || !Number.isFinite(amount)) die("Usage: finops budget-set <category> <amount>");
  const result = await send("/api/budgets/target", cfg, "PATCH", { category, monthlyTarget: amount });
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(budgetSetLine(result));
}

async function cmdApplySimilar(args, cfg) {
  const [merchant, category] = args._;
  if (!merchant || !category) die('Usage: finops apply-similar <merchant> <category>');
  const result = await send("/api/transactions/apply-similar", cfg, "POST", { merchant, category });
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  console.log(`applied to ${result.updated}`);
}

async function cmdFI(args, cfg) {
  // --extra / --lump switch to the repayment→FI simulator: does putting more on
  // the mortgage reach FI sooner than investing the same money?
  if (args.extra != null || args.lump != null) {
    const qs = new URLSearchParams();
    if (args.extra != null) qs.set("extraPerMonth", String(args.extra));
    if (args.lump != null) qs.set("lumpSum", String(args.lump));
    const data = await api(`/api/fi/repayment${qs.toString() ? `?${qs}` : ""}`, cfg);
    if (args.json) return console.log(JSON.stringify(data, null, 2));
    for (const line of repaymentFILines(data)) console.log(line);
    return;
  }
  const data = await api("/api/fi", cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  for (const line of fiLines(data)) console.log(line);
}

async function cmdSubs(args, cfg) {
  const data = await api("/api/subscriptions", cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  for (const line of subsLines(data)) console.log(line);
}

async function cmdBuffer(args, cfg) {
  const data = await api("/api/buffer", cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  for (const line of bufferLines(data)) console.log(line);
}

async function cmdAsset(args, cfg) {
  const sub = args._[0];

  if (!sub || sub === "list") {
    const data = await api("/api/assets", cfg);
    if (args.json) return console.log(JSON.stringify(data, null, 2));
    for (const line of assetLines(data)) console.log(line);
    return;
  }

  if (sub === "set") {
    const name = args._[1];
    const amount = Number(args._[2]);
    if (!name || !Number.isFinite(amount)) {
      die('Usage: finops asset set "<name>" <amount> [--type other|investment|savings] [--id manual_x]');
    }
    const body = { name, balance: amount };
    if (args.type) body.type = args.type;
    if (args.id) body.id = args.id;
    if (args.loan) {
      if (!args.category) die('--loan requires --category "<category name>"');
      body.loan = { annualRate: Number(args.rate ?? 0), repaymentCategory: args.category };
      if (args["anchor-date"]) body.loan.anchorDate = String(args["anchor-date"]);
    }
    if (args.receivable || args.type === "receivable") {
      body.type = "receivable";
      body.inflow = {
        likelihood: args.likelihood === "uncertain" ? "uncertain" : "likely",
        expectedDate: args.expected ?? null,
        preTax: !!args["pre-tax"],
        taxRate: Number(args["tax-rate"] ?? 0),
      };
    }
    const data = await send("/api/assets", cfg, "POST", body);
    if (args.json) return console.log(JSON.stringify(data, null, 2));
    const a = data.asset;
    console.log(`Saved ${a.name} — ${money(a.balance)} · ${a.type}  ${a.id}`);
    return;
  }

  if (sub === "rm") {
    let id = args._[1];
    if (!id) die("Usage: finops asset rm <manual_id|name>");
    if (!id.startsWith("manual_")) {
      const data = await api("/api/assets", cfg);
      const match = (data.assets ?? []).find(
        (a) => a.name.toLowerCase() === id.toLowerCase(),
      );
      if (!match) die(`No manual asset named "${id}".`);
      id = match.id;
    }
    await send(`/api/assets?id=${encodeURIComponent(id)}`, cfg, "DELETE");
    console.log(`Removed ${id}.`);
    return;
  }

  die(`Unknown asset subcommand: ${sub}`);
}

async function cmdIncome(args, cfg) {
  const qs = new URLSearchParams();
  if (args.limit) qs.set("limit", String(args.limit));
  const data = await api(`/api/income/history${qs.toString() ? `?${qs}` : ""}`, cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  console.log(incomeHistoryLines(data));
}


async function cmdBurn(args, cfg) {
  const qs = new URLSearchParams();
  if (args.trailing) qs.set("trailing", String(args.trailing));
  const data = await api(`/api/spend/daily-burn${qs.toString() ? `?${qs}` : ""}`, cfg);
  if (args.json) return console.log(JSON.stringify(data, null, 2));
  console.log(burnLines(data));
}

function cmdLogin(args) {
  const token = args._[0];
  if (!token) die("Usage: finops login <fops_…> [apiUrl]");
  const cfg = { token };
  if (args._[1]) cfg.apiUrl = args._[1].replace(/\/$/, "");
  saveConfig(cfg);
  console.log(`Saved token to ${CONFIG_PATH}${cfg.apiUrl ? ` (api ${cfg.apiUrl})` : ""}.`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return;
  }
  if (cmd === "login") return cmdLogin(args);

  const cfg = loadConfig();
  switch (cmd) {
    case "budget":
    case "budgets":
      return cmdBudget(args, cfg);
    case "review":
      return cmdReview(args, cfg);
    case "net-worth":
    case "networth":
      return cmdNetWorth(args, cfg);
    case "investments":
    case "invest":
    case "holdings":
      return cmdInvestments(args, cfg);
    case "invest-since":
      return cmdInvestSince(args, cfg);
    case "forecast":
      return cmdCashflow(args, cfg);
    case "mortgage":
      return cmdMortgage(args, cfg);
    case "categorise":
    case "categorize":
      return cmdCategorise(args, cfg);
    case "accept":
      return cmdAccept(args, cfg);
    case "budget-set":
      return cmdBudgetSet(args, cfg);
    case "apply-similar":
      return cmdApplySimilar(args, cfg);
    case "fi":
      return cmdFI(args, cfg);
    case "subs":
      return cmdSubs(args, cfg);
    case "buffer":
      return cmdBuffer(args, cfg);
    case "asset":
    case "assets":
      return cmdAsset(args, cfg);
    case "income":
      return cmdIncome(args, cfg);
    case "burn":
      return cmdBurn(args, cfg);
    case "runway":
      return cmdCashflow(args, cfg);
    default:
      die(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e) => die(`Unexpected error: ${e.message}`));
