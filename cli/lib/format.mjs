// Pure output formatters for the finops CLI.
// Kept dependency-free and side-effect-free so they're unit-testable and the
// output stays compact (token-efficient — Claude reads this inside a terminal).

/** Whole-dollar money, e.g. -1234.5 -> "-$1,235". */
export function money(n) {
  const num = Number(n) || 0;
  // Round the magnitude so -1234.5 -> -$1,235 (Math.round alone rounds .5
  // toward +∞, which would give -$1,234 — surprising for money).
  const v = Math.sign(num) * Math.round(Math.abs(num));
  const sign = v < 0 ? "-" : "";
  return sign + "$" + Math.abs(v).toLocaleString("en-NZ");
}

/** Round a percentage to a whole number. */
export function pct(n) {
  return `${Math.round(Number(n) || 0)}%`;
}

/**
 * One-line income position summary, e.g.
 *   Income: $7,349 earned · plan $11,270/mo · run-rate $9,866 (-$1,404 vs plan)
 * The plan/run-rate segment is omitted when no income budget is set (planned 0).
 */
export function positionLine(position) {
  const inc = position?.income ?? {};
  const earned = `Income: ${money(inc.actual)} earned`;
  if (!(Number(inc.planned) > 0)) return earned;
  const delta = Number(inc.recentRunRate) - Number(inc.planned);
  const sign = delta >= 0 ? "+" : "-";
  return `${earned} · plan ${money(inc.planned)}/mo · run-rate ${money(inc.recentRunRate)} (${sign}${money(Math.abs(delta))} vs plan)`;
}

/**
 * Structural plan-vs-plan line, e.g.
 *   Budgets: $9,540/mo vs $11,270/mo income (+$1,730/mo headroom)
 * Answers "do the caps I've SET fit inside my planned income?", independent of
 * how this cycle is tracking. Returns null when no income plan or no budgets
 * exist (nothing meaningful to compare).
 */
export function plannedNetLine(position) {
  const planned = Number(position?.income?.planned) || 0;
  const budget = Number(position?.expenses?.budget) || 0;
  if (!(planned > 0) || !(budget > 0)) return null;
  const net = Number(position?.net?.planned) || 0;
  const sign = net >= 0 ? "+" : "-";
  const label = net >= 0 ? "headroom" : "over";
  return `Budgets: ${money(budget)}/mo vs ${money(planned)}/mo income (${sign}${money(Math.abs(net))}/mo ${label})`;
}

const RAG = { ok: "ok", warning: "warn", over: "OVER" };

/**
 * One budget line, e.g.
 *   Groceries          $340 of $1,200   28%  · 18d · proj $567   ok
 * Reserve categories show their accrued balance instead of a target.
 */
export function budgetLine(row, daysLeft) {
  const name = String(row.category).padEnd(20).slice(0, 20);
  const tag = RAG[row.status] ?? row.status ?? "";

  if (row.kind === "reserve") {
    const bal = money(row.reserveBalance ?? 0);
    const low = (row.reserveBalance ?? 0) < 0 ? "  OVERDRAWN" : "";
    return `${name} reserve ${bal}  (spent ${money(row.netSpent)})${low}`;
  }

  if (row.kind === "savings") {
    // Contribution goal: money set aside this cycle vs the monthly target. Full = win.
    const met = row.pct >= 100 ? "  ✓ goal met" : "";
    return `${name} saved ${money(row.netSpent)} of ${money(row.target)} this cycle${met}`;
  }

  const parts = [`${money(row.netSpent)} of ${money(row.target)}`.padEnd(20), pct(row.pct).padStart(4)];
  const meta = [];
  if (Number.isFinite(daysLeft)) meta.push(`${daysLeft}d`);
  if (row.projected != null) meta.push(`proj ${money(row.projected)}`);
  // Provisional unsettled spend already made at the bank — additive to netSpent.
  if (Number(row.pendingSpent) > 0) meta.push(`+${money(row.pendingSpent)} pending`);
  const metaStr = meta.length ? `· ${meta.join(" · ")}` : "";
  return `${name} ${parts.join("  ")}  ${metaStr}  ${tag}`.replace(/\s+$/, "");
}

/** A single-category answer, mirroring design.md's target phrasing. */
export function budgetSentence(row, daysLeft) {
  if (row.kind === "reserve") {
    const bal = row.reserveBalance ?? 0;
    const state = bal < 0 ? "overdrawn" : "available";
    return `${row.category}: reserve ${money(bal)} ${state} (spent ${money(row.netSpent)} this period).`;
  }

  if (row.kind === "savings") {
    const met = row.pct >= 100 ? " Goal met." : "";
    return `${row.category}: ${money(row.netSpent)} of ${money(row.target)} set aside this cycle (${pct(row.pct)}).${met}`;
  }
  const tail =
    row.projected != null
      ? ` On pace: ${money(row.projected)} projected.`
      : "";
  const days = Number.isFinite(daysLeft) ? `, ${daysLeft} days left` : "";
  // Provisional unsettled spend: surface the true committed position so the
  // "can I spend on X right now?" answer isn't fooled by settlement lag.
  const pend = Number(row.pendingSpent) > 0
    ? ` Incl. ${money(row.pendingSpent)} pending → ${money(row.netSpent + row.pendingSpent)} of ${money(row.target)} committed.`
    : "";
  return `${row.category}: ${money(row.netSpent)} of ${money(row.target)} (${pct(row.pct)})${days}.${tail}${pend}`;
}

/** Signed 1-dp percent, e.g. 14.3 -> "+14.3%", -2 -> "-2.0%". */
function pct1(n) {
  const v = Number(n) || 0;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`;
}

/**
 * Investment holdings lines for `finops investments`. Each account shows its
 * NZD value, cumulative return, and annualised (CAGR) growth — `+x.x%/yr` when
 * computable, else a hint to set a start date. Returns an array of strings.
 */
export function investmentsLines(data) {
  const accounts = data.accounts ?? [];
  if (!accounts.length) return ["No holdings yet (sync investment/KiwiSaver accounts)."];
  const out = [];
  const p = data.portfolio;
  if (p) {
    const ann = p.annualisedPct != null ? `  ${pct1(p.annualisedPct)}/yr` : "  [set start dates]";
    const cum = p.returnPct != null ? ` (${pct1(p.returnPct)} total)` : "";
    const partial =
      p.annualisedPct != null && p.annualisedCoverageNZD < p.valueNZD
        ? `  — annualised across ${money(p.annualisedCoverageNZD)} of ${money(p.valueNZD)}`
        : "";
    out.push(`Portfolio  ${money(p.valueNZD)}${ann}${cum}${partial}`);
  }
  for (const g of accounts) {
    const value = g.balanceNZD ?? g.totalValue;
    const showReturn = g.currency !== null; // suppress native totals if mixed
    const ret = showReturn
      ? `  ${money(g.totalReturn)} (${pct1(g.returnPct ?? 0)})`
      : g.returnPct != null
        ? `  (mixed: ${pct1(g.returnPct)} blended)`
        : "  (mixed currency)";
    let ann;
    if (g.annualisedPct != null) ann = `  ${pct1(g.annualisedPct)}/yr`;
    else if (!g.inception) ann = "  [set start date]";
    else ann = "  (<6mo)";
    const since = g.inception ? `  since ${g.inception}` : "";
    out.push(`${g.accountName} (${g.accountType})  ${money(value)}${ret}${ann}${since}`);
    for (const f of g.holdings ?? []) {
      const fa = f.annualisedPct != null ? `  ${pct1(f.annualisedPct)}/yr` : "";
      const fr = f.returnPct != null ? ` (${pct1(f.returnPct)})` : "";
      out.push(`  ${String(f.name).slice(0, 28).padEnd(28)} ${money(f.value)}${fr}${fa}`);
    }
  }
  return out;
}

/**
 * Mortgage P&I summary lines for `finops mortgage`. Read-only FI lens, not a
 * budget. Returns an array of strings (one per line).
 */
export function mortgageLines(data) {
  const out = [];
  const t = data.totals ?? {};
  out.push(
    `Mortgage ${data.year} YTD  ·  interest ${money(t.interestYtd)}  ·  principal ${money(t.principalYtd)}  ·  owing ${money(t.balance)}`,
  );
  const word = data.estimated ? "est." : "contractual";
  if (data.payoff?.freeDate)
    out.push(`  Mortgage-free ~${data.payoff.freeDate} at current rate/payment (${word})`);
  else if (data.payoff?.monthsRemaining === null)
    out.push(`  Mortgage-free: payment not covering interest — can't project`);
  for (const p of data.parts ?? []) {
    const name = String(p.name).padEnd(16).slice(0, 16);
    const i = p.interestYtd == null ? "int n/a (shared)" : `int ${money(p.interestYtd)}`;
    const pr = p.principalYtd == null ? "" : ` · prin ${money(p.principalYtd)}`;
    const rate = p.ratePct ? ` · ${p.ratePct}%${p.rateSource === "estimated" ? "~" : ""}` : "";
    const refix = p.fixedUntil ? ` · fixed→${p.fixedUntil}` : "";
    const free = p.payoff?.freeDate ? ` · free ~${p.payoff.freeDate}` : "";
    out.push(`  ${name} owing ${money(p.balance)} · ${i}${pr}${rate}${refix}${free}`);
  }
  for (const rv of data.revolving ?? []) {
    out.push(`  ${String(rv.name).padEnd(16).slice(0, 16)} owing ${money(rv.balance)} · int ${money(rv.interestYtd)} · interest-only (set a repayment to clear)`);
  }
  const s = data.scenario;
  if (s?.applied) {
    const saved = s.interestSaved != null ? `, saves ${money(s.interestSaved)} interest` : "";
    if (s.freeDate) out.push(`  Scenario → mortgage-free ~${s.freeDate}${saved}`);
    else out.push(`  Scenario → still not clearing${saved}`);
  }
  return out;
}

/**
 * Forecast summary lines for `finops forecast`. Cash-runway lens.
 * Returns an array of strings (one per line).
 */
export function forecastLines(d) {
  const lines = [];
  lines.push(`${d.verdict.makesIt ? "✓" : "⚠"} ${d.verdict.text}`);
  lines.push(`  Lowest ${money(d.trough.balance)} on ${d.trough.date}`);
  if (d.billsDue) {
    const n = d.billsDue.count;
    lines.push(`  Bills ${money(d.billsDue.amount)} due ${d.billsDue.date} (${n} bill${n === 1 ? "" : "s"})`);
  }
  if (d.nextPayday) lines.push(`  Next pay ${money(d.nextPayday.amount)} on ${d.nextPayday.date}`);
  // revolvingDrawn is stored negative (a drawn liability); show its magnitude as
  // "drawn on revolving", matching the PWA forecast page's presentation.
  lines.push(`  Start ${money(d.startBalance)} everyday · ${money(d.context.reservesEarmarked)} earmarked · ${money(Math.abs(d.context.revolvingDrawn))} drawn on revolving`);
  return lines;
}

const SPARK = "▁▂▃▄▅▆▇█";

// Compact spend sparkline (relative to each point's target) + per-cycle lines.
export function budgetHistoryLines(category, series) {
  if (!series.length) return `No history for "${category}".`;
  const chronological = [...series].reverse(); // oldest -> newest for the sparkline
  const spark = chronological
    .map((p) => {
      const ratio = p.target > 0 ? Math.min(1, Math.max(0, p.effective_spend / p.target)) : 0;
      return SPARK[Math.round(ratio * (SPARK.length - 1))];
    })
    .join("");
  const flag = { ok: " ", warning: "!", over: "×" };
  const lines = series.map((p) => {
    const month = p.period_start.slice(0, 7);
    return `  ${month}  ${money(p.effective_spend)} / ${money(p.target)}  ${pct(p.pct)}${flag[p.status] ?? ""}`;
  });
  return `${category}  ${spark}\n${lines.join("\n")}`;
}

// Per-cycle income: total/plan with a run-rate sparkline + a line per cycle.
export function incomeHistoryLines(history) {
  const cycles = history.cycles ?? [];
  if (!cycles.length) return "No income history yet.";
  const chronological = [...cycles].reverse(); // oldest -> newest for the sparkline
  const spark = chronological
    .map((c) => {
      const ratio = c.plannedTotal > 0 ? Math.min(1, Math.max(0, c.total / c.plannedTotal)) : 0;
      return SPARK[Math.round(ratio * (SPARK.length - 1))];
    })
    .join("");
  const lines = cycles.map((c) => {
    const month = c.period_start.slice(0, 7);
    const flag = c.plannedTotal > 0 && c.total < c.plannedTotal * 0.8 ? "!" : " ";
    return `  ${month}  ${money(c.total)} / ${money(c.plannedTotal)}${flag}`;
  });
  return `Income  ${spark}\n${lines.join("\n")}`;
}

/** Signed whole-dollar money, e.g. 12 -> "+$12", -12 -> "-$12". */
function signedMoney(n) {
  const num = Number(n) || 0;
  return (num >= 0 ? "+" : "") + money(num);
}

// Daily burn: a per-day spend sparkline (scaled to the busiest day / plan) plus
// the trailing pace vs the planned daily figure and the trend direction.
export function burnLines(d) {
  const days = d.days ?? [];
  if (!days.length) return "No burn yet this cycle.";
  const scaleMax = Math.max(...days.map((x) => x.spend), d.plannedPerDay, 1);
  const spark = days
    .map((x) => SPARK[Math.round(Math.min(1, Math.max(0, x.spend / scaleMax)) * (SPARK.length - 1))])
    .join("");
  const dir = d.priorPerDay != null ? (d.trend > 0 ? " ↑ rising" : d.trend < 0 ? " ↓ easing" : " flat") : "";
  return [
    `Daily burn  ${spark}`,
    `  ${signedMoney(d.vsPlan)}/day vs plan${dir}`,
    `  Trailing ${d.trailingDays}d ${money(d.trailingPerDay)}/day · plan ${money(d.plannedPerDay)}/day · cycle avg ${money(d.cyclePerDay)}/day`,
    `  Spent ${money(d.spentSoFar)} over ${d.dayOfPeriod} of ${d.periodLength} days`,
  ].join("\n");
}

/** Cashflow game-plan: cash + credit zero-dates per scenario + next-bills verdict. */
export function cashflowLines(d) {
  const lines = [`Cashflow game-plan · ${money(d.startLiquid)} cash · ${money(d.creditHeadroom)} credit headroom`];
  if (Array.isArray(d.inflows) && d.inflows.length) {
    const owed = d.inflows.map((i) =>
      i.taxRate > 0
        ? `${i.label} ${money(i.amount)} (~${money(i.amount * (1 - i.taxRate))} net)`
        : `${i.label} ${money(i.amount)}`,
    );
    lines.push(`  expected: ${owed.join(" · ")}`);
  }
  if (d.nextBills) {
    const v = d.verdict?.makesIt
      ? `clears ${d.nextBills.date} bills with ${money(d.verdict.margin)} cash to spare`
      : `${money(d.verdict.margin)} short of ${d.nextBills.date} bills (then on credit)`;
    lines.push(`  next bills: ${v}`);
  }
  for (const l of d.lines) {
    const cash = l.cashZeroDate ? `cash ${l.cashZeroDate}` : "covered";
    const credit = l.creditZeroDate ? `credit ${l.creditZeroDate} (${Math.round(l.weeksToCredit)} wks)` : "credit ok";
    lines.push(`  ${l.label.padEnd(16)} ${cash} · ${credit}`);
  }
  return lines;
}


// One compact block: a line per active subscription, then a total. Lapsed subs
// are omitted from the CLI (the PWA shows them dimmed).
export function subsLines(data) {
  const active = data.subscriptions.filter((s) => s.status === "active");
  if (active.length === 0) return ["No subscriptions detected yet."];
  const lines = active.map((s) => {
    const flag = s.priceChanged ? " ↑" : "";
    return `  ${s.displayName.padEnd(22)} ${money(s.monthly).padStart(9)}/mo  ${s.cadence.padEnd(11)} next ${s.nextExpected}${flag}`;
  });
  lines.push(
    `\n  ${"Total".padEnd(22)} ${String(data.totals.monthly.toFixed(2)).padStart(9)}/mo  (${money(data.totals.annual)}/yr · ${data.totals.count} subs)`,
  );
  return lines;
}

export function assetLines(data) {
  const assets = data.assets ?? [];
  if (assets.length === 0) return ["No manual assets."];
  const lines = ["Manual assets:"];
  for (const a of assets) {
    const fi = a.feedsFI ? " [FI]" : "";
    const auto = a.autoRefreshed ? " (auto)" : "";
    const loan = a.loan
      ? `  ↳ loan @ ${a.loan.annualRate}% · ${a.loan.repaymentCategoryName ?? "?"}${a.loan.anchorDate ? ` · as of ${a.loan.anchorDate}` : ""}`
      : "";
    const inflow = a.inflow
      ? `  ↳ inflow ${a.inflow.likelihood}${a.inflow.expectedDate ? ` by ${a.inflow.expectedDate}` : ""}${a.inflow.preTax ? ` · ${Math.round(a.inflow.taxRate * 100)}% tax` : ""}`
      : "";
    lines.push(`  ${a.name} — ${money(a.balance)} · ${a.type}${fi}${auto}  ${a.id}${loan}${inflow}`);
  }
  return lines;
}

/** A pending-review transaction line for `finops review`, with a short id handle. */
export function reviewLine(t) {
  const id = (t.id ?? "").slice(0, 8);
  const date = (t.occurred_at ?? "").slice(0, 10);
  const who = (t.merchant || t.description || "—").slice(0, 32).padEnd(32);
  return `[${id}]  ${date}  ${money(t.amount).padStart(9)}  ${who}  ${t.account ?? ""}`.replace(/\s+$/, "");
}

/** Budget-set confirmation: "Groceries  $1,200 → $1,350". */
export function budgetSetLine(r) {
  return `${r.category}  ${money(r.previousTarget)} → ${money(r.newTarget)}`;
}

/**
 * Financial-independence summary lines for `finops fi`. Reuses `money`.
 * Returns an array of strings (one per line).
 */
export function fiLines(d) {
  const lines = [];
  lines.push(`${Math.round(d.pctToFI * 100)}% to FI · ${money(d.fiNumber)} target (~${money(d.annualRecurringSpend)}/yr ÷ ${Math.round(d.assumptions.swr * 100)}%)`);
  if (d.projection.reached) {
    const vs = d.vsTargetYears == null ? "" :
      d.vsTargetYears <= 0 ? `, ${Math.abs(d.vsTargetYears)}yr early` : `, ${d.vsTargetYears}yr past age ${d.targetAge}`;
    lines.push(`  On track: ${d.projection.fiDate} (age ${d.projection.fiAge})${vs}`);
  } else {
    lines.push(`  Not on track within 50 years at this savings rate`);
  }
  lines.push(`  ${d.monthlyContribution > 0 ? `${money(d.monthlyContribution)}/mo actually saved (trailing ${d.assumptions.contributionWindowMonths}mo)` : `Nothing saved in the last ${d.assumptions.contributionWindowMonths}mo`}`);
  const a = d.assumptions;
  if (a.actualReturnPct || a.actualReturnAnnualisedPct != null) {
    const pct = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;
    const cum = `${pct(a.actualReturnPct)} total since purchase`;
    lines.push(
      `  Portfolio: ${a.actualReturnAnnualisedPct != null ? `${pct(a.actualReturnAnnualisedPct)}/yr annualised · ${cum}` : cum}`,
    );
  }
  return lines;
}

// Repayment→FI simulator: invest-the-extra vs pay-the-mortgage, both deploying
// the same total each month. Leads with the verdict, then each arm's FI date.
export function repaymentFILines(d) {
  const lines = [];
  const arm = (a) =>
    a.fiReached && a.fiDate ? `${a.fiDate} (age ${a.fiAge})` : "not within 50yr";
  const yrs = (m) => {
    const a = Math.abs(m);
    const y = Math.floor(a / 12);
    const mo = a % 12;
    return y ? (mo ? `${y}yr ${mo}mo` : `${y}yr`) : `${mo}mo`;
  };
  const lump = d.lumpSum > 0 ? ` + ${money(d.lumpSum)} lump` : "";
  lines.push(`Extra ${money(d.extraPerMonth)}/mo${lump} on the mortgage vs invested:`);
  if (d.verdict === "pay_mortgage") {
    lines.push(`  → Paying it down wins: FI ${d.monthsSooner != null ? `${yrs(d.monthsSooner)} sooner` : "reached, investing isn't"}`);
  } else if (d.verdict === "invest") {
    lines.push(`  → Investing wins: FI ${d.monthsSooner != null ? `${yrs(d.monthsSooner)} sooner` : "reached, paying down isn't"}`);
  } else {
    lines.push(`  → Line-ball: same FI date either way`);
  }
  lines.push(`  Pay mortgage:  FI ${arm(d.payMortgageArm)} · mortgage-free ${d.payMortgageArm.mortgageFreeDate ?? "—"}`);
  lines.push(`  Invest extra:  FI ${arm(d.investArm)} · mortgage-free ${d.investArm.mortgageFreeDate ?? "—"}`);
  if (d.mortgage && d.mortgage.interestSaved != null && d.mortgage.interestSaved > 0) {
    lines.push(`  Paying down also saves ${money(d.mortgage.interestSaved)} mortgage interest (life of loan)`);
  }
  lines.push(`  Once clear, the freed ${money(d.freedPayment)}/mo repayment redirects to investing (both arms).`);
  return lines;
}

// Emergency fund (cash buffer): progress toward N months of essentials.
export function bufferLines(d) {
  const lines = [];
  if (!d.configured) {
    lines.push(`Emergency fund: not set up — target ~${money(d.target)} (${d.targetMonths} mo of essentials).`);
    lines.push(`  Designate a savings account as the emergency fund on the Connect page.`);
    return lines;
  }
  const pct = d.pctFunded != null ? `${Math.round(d.pctFunded * 100)}%` : "—";
  const cover = d.monthsCovered != null ? `${d.monthsCovered.toFixed(1)}` : "—";
  lines.push(`Emergency fund (${d.accountName}): ${money(d.balance)} / ${money(d.target)} · ${pct} funded`);
  lines.push(
    d.shortfall > 0
      ? `  ${cover} of ${d.targetMonths} mo essentials covered · ${money(d.shortfall)} short`
      : `  ${cover} of ${d.targetMonths} mo essentials covered · fully funded`,
  );
  return lines;
}

/**
 * Categorise result line, nudging apply-similar when there are similar txns.
 * The merchant comes from the result's `similarMerchant` (set only for merchant-
 * based rules). With a merchant + category we print a runnable command; without
 * one (description-based rule) we print a plain count, since apply-similar matches
 * on merchant and wouldn't help.
 */
export function categoriseResultLine(r) {
  const base = `categorised ${r.updated}`;
  if (!r.similarCount) return base;
  if (r.similarMerchant && r.category) {
    return `${base} · ${r.similarCount} similar — run finops apply-similar "${r.similarMerchant}" "${r.category}" to include them`;
  }
  return `${base} · ${r.similarCount} similar uncategorised — categorise those too to bulk-apply`;
}
