import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { type BudgetStatusRow } from "@/lib/budgets/compute";
import { getCachedBudgets } from "@/lib/budgets/cached";
import { computeForecast } from "@/lib/forecast/compute";
import { isCurrentlySalaried } from "@/lib/income/salaried";
import { computeCashflow } from "@/lib/cashflow/compute";
import { CashflowHero } from "@/components/cashflow-hero";
import { defaultPeriod, parseDate, toISODate, type Period } from "@/lib/budgets/period";
import { DateRangePicker } from "@/components/date-range-picker";
import { ExpandAllToggle } from "./expand-all";
import { ModeToggle, type DisplayMode } from "./mode-toggle";
import { SortToggle, type SortKey } from "./sort-toggle";
import { InfoSheet } from "@/components/info-sheet";
import { ChevronRight } from "@/components/icons";
import { getHistoryMap } from "@/lib/budgets/snapshot";
import { BudgetTrendChart } from "@/components/budget-trend-chart";
import { getIncomeHistory } from "@/lib/income/history";
import { getDailyBurn } from "@/lib/spend/daily-burn";
import { DailyBurnChart } from "@/components/daily-burn-chart";
import { ExplainerTrigger } from "@/components/explainer-trigger";
import { explainIncomePace, explainDailyBurn } from "@/lib/explainers/budget-hero";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { PositionCard } from "@/components/position-card";
import { SpendingVsPlanCard } from "@/components/spending-vs-plan-card";
import { IncomePaceChart } from "@/components/income-pace-card";
import type { IncomePoint } from "@/lib/budgets/income-pace-geometry";
import { loadAllocationInput } from "@/lib/allocation/load";
import { computeAllocation } from "@/lib/allocation/compute";
import { computeSweepNudge, type SweepNudge } from "@/lib/reserves/nudge";
import { SweepNudgeCard } from "@/components/sweep-nudge";

export const dynamic = "force-dynamic";

function progressColor(status: BudgetStatusRow["status"]): string {
  if (status === "over") return "bg-negative-bar";
  if (status === "warning") return "bg-warning-bar";
  return "bg-positive-bar";
}

// Income RAG is inverted vs expenses: at/above target is good (green),
// falling short is bad (red).
function incomeColor(pct: number): string {
  if (pct >= 100) return "bg-positive-bar";
  if (pct >= 80) return "bg-warning-bar";
  return "bg-negative-bar";
}

// Savings is a contribution goal: the bar FILLS toward the target and going full
// is the win. Hitting the goal turns green; below goal is a calm savings-accent
// fill (progress, not a warning) — it never reads red.
function savingsColor(pct: number): string {
  return pct >= 100 ? "bg-positive-bar" : "bg-savings";
}

function kindPillClass(kind: string): string {
  switch (kind) {
    case "monthly_cap":
      return "bg-accent-weak text-accent";
    case "reserve":
      return "bg-reserve-weak text-reserve";
    case "savings":
      return "bg-savings-weak text-savings";
    case "ap_amortised":
      return "bg-autopay-weak text-autopay";
    case "income":
      return "bg-positive-weak text-positive";
    default:
      return "bg-sunken text-ink-muted";
  }
}

function kindLabel(kind: string): string {
  if (kind === "monthly_cap") return "monthly";
  if (kind === "ap_amortised") return "auto-pay";
  if (kind === "income") return "income";
  if (kind === "savings") return "savings";
  return kind;
}

// Month abbreviation from a cycle-start ISO date (e.g. "2026-02-20" → "Feb"),
// derived from the month digits to avoid any timezone shift on the boundary.
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function cycleMonth(iso: string): string {
  return MONTH_ABBR[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7);
}

const GROUP_ORDER = [
  "Income",
  "Food",
  "Discretionary",
  "Kids",
  "Wellbeing",
  "Transit",
  "Maintenance",
  "Utilities",
  "Fixed",
  "Mortgage",
  "Investments",
  "Savings",
  "Business",
  "System",
];

const KIND_ORDER: string[] = ["income", "monthly_cap", "reserve", "savings", "ap_amortised"];
const KIND_LABEL: Record<string, string> = {
  income: "Income",
  monthly_cap: "Monthly cap",
  reserve: "Reserve",
  savings: "Savings",
  ap_amortised: "Auto-pay",
};

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; mode?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const mode: DisplayMode =
    sp.mode === "type" || sp.mode === "flow" ? sp.mode : "category";
  const sort: SortKey =
    sp.sort === "pct" || sp.sort === "remaining" || sp.sort === "name" ? sp.sort : "target";

  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  const defaults = defaultPeriod(now);
  const period: Period = {
    start: parseDate(sp.from, defaults.start),
    end: parseDate(sp.to, defaults.end),
  };

  let result;
  try {
    result = await getCachedBudgets(householdId, period, now);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load budgets";
    return <p className="text-sm text-negative">{message}</p>;
  }

  // Everything below depends only on `result` (or nothing), so fan them out in a
  // single parallel stage instead of a serial waterfall — collapses six sequential
  // round-trips into two. Each supplemental loader owns its own failure so one
  // slow/broken widget never blocks (or breaks) the rest of the page; `historyMap`
  // stays unguarded so its failure still surfaces, matching prior behaviour.
  const [forecast, cashflow, historyMap, incomeHistory, burn, salaried, allocInput] = await Promise.all([
    computeForecast({ supabase, householdId }).catch(
      () => null as Awaited<ReturnType<typeof computeForecast>> | null,
    ),
    computeCashflow({ supabase, householdId }).catch(
      () => null as Awaited<ReturnType<typeof computeCashflow>> | null,
    ),
    getHistoryMap(supabase, householdId),
    getIncomeHistory(supabase, householdId, { limit: 12 }).catch(
      () => null as Awaited<ReturnType<typeof getIncomeHistory>> | null,
    ),
    getDailyBurn(supabase, householdId, { now }).catch(
      () => null as Awaited<ReturnType<typeof getDailyBurn>> | null,
    ),
    // Gate for the income-pace card: only meaningful while there's a salary to
    // pace against. Defaults to salaried (true) if the check errors.
    isCurrentlySalaried({ supabase, householdId, now }).catch(() => true),
    // Reuse the budgets result already computed above — avoids a second computeBudgets.
    loadAllocationInput({ supabase, householdId, budgets: result }).catch(
      () => null as Awaited<ReturnType<typeof loadAllocationInput>> | null,
    ),
  ]);

  let sweepNudge: SweepNudge | null = null;
  if (allocInput) {
    try {
      const alloc = computeAllocation(allocInput);
      const reserveRungs = alloc.rungs.filter((r) => r.key === "reserve");
      sweepNudge = computeSweepNudge({
        recommended: reserveRungs.reduce((s, r) => s + r.amount, 0),
        sweptThisCycle: result.reserveBuffer.sweptThisCycle,
        perReserve: reserveRungs.map((r) => ({ category: r.title, covers: r.amount })),
        // Gate on the forward-cashflow trough so the card only ever suggests cash
        // that survives the next bill cluster. Null forecast ⇒ plan-only (ungated).
        trough: forecast?.trough ?? null,
      });
    } catch {
      sweepNudge = null; // supplemental — never break the budgets page
    }
  }

  const { dayOfPeriod, periodLength, daysLeft } = result.period;
  const rows = result.rows;
  const flex = result.flex.amount;
  const flexCategoriesIncluded = result.flex.categoriesIncluded;
  const position = result.position;
  const categorisedInWindow = result.inbox.categorisedInWindow;
  const inboxInWindow = result.inbox.inboxInWindow;

  // Adapt the income-trend feature's per-cycle series (newest-first) into the
  // pace chart's IncomePoint[] (oldest→newest, current = the newest cycle). Last
  // 6 cycles keeps the bars readable; the pace chart layers plan + expected-by-now.
  const incomeSeries: IncomePoint[] = incomeHistory
    ? [...incomeHistory.cycles]
        .reverse()
        .slice(-6)
        .map((c, i, arr) => ({
          periodStart: c.period_start,
          label: cycleMonth(c.period_start),
          total: c.total,
          isCurrent: i === arr.length - 1,
        }))
    : [];
  const unallocatedPending = result.unallocatedPending;

  // High-signal "at a glance" tiles. Tile 2: the monthly-cap category furthest
  // over its cap this cycle (most dollars over). Tile 3: the reserve category
  // sitting lowest — the most under-funded, which can be negative now that the
  // clamp is gone.
  const topOverCap = rows
    .filter((r) => r.kind === "monthly_cap" && r.target > 0)
    .sort((a, b) => b.effectiveSpend - b.target - (a.effectiveSpend - a.target))[0];
  const lowestReserve = rows
    .filter((r) => r.kind === "reserve" && r.reserveBalance !== null)
    .sort((a, b) => (a.reserveBalance ?? 0) - (b.reserveBalance ?? 0))[0];

  const dateRange = { from: toISODate(period.start), to: toISODate(period.end) };

  const grouped = new Map<string, BudgetStatusRow[]>();
  for (const r of rows) {
    const g = r.group ?? "Other";
    if (!grouped.has(g)) grouped.set(g, []);
    grouped.get(g)!.push(r);
  }
  const orderedGroups = [
    ...GROUP_ORDER.filter((g) => grouped.has(g)),
    ...Array.from(grouped.keys()).filter((g) => !GROUP_ORDER.includes(g)),
  ];

  function statTileHref(r: BudgetStatusRow) {
    return `/transactions?category=${r.categoryId}&from=${dateRange.from}&to=${dateRange.to}`;
  }

  function renderStatTile(
    r: BudgetStatusRow | undefined,
    emptyLabel: string,
    emptySub: string,
    value: string,
    valueClass: string,
  ) {
    const inner = (
      <>
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
          {r ? r.category : emptyLabel}
        </div>
        <div className={`mt-1 text-[21px] font-bold tabular-nums ${valueClass}`}>{value}</div>
        <div className="mt-1">
          {r ? (
            <span
              className={`inline-block rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${kindPillClass(
                r.kind,
              )}`}
            >
              {kindLabel(r.kind)}
            </span>
          ) : (
            <span className="text-[11px] text-ink-faint">{emptySub}</span>
          )}
        </div>
      </>
    );
    if (!r) {
      return <div className="rounded-card bg-surface p-4 shadow-card">{inner}</div>;
    }
    return (
      <Link
        href={statTileHref(r)}
        className="block rounded-card bg-surface p-4 shadow-card transition-colors hover:bg-sunken"
      >
        {inner}
      </Link>
    );
  }

  function renderTopOverTile(r: BudgetStatusRow | undefined) {
    if (!r) return renderStatTile(undefined, "Top overage", "no caps", "$0", "text-ink-faint");
    const over = r.effectiveSpend - r.target;
    const isOver = over > 0;
    return renderStatTile(
      r,
      "",
      "",
      `${isOver ? "−" : "+"}${formatCurrency(Math.abs(over), { decimals: 0, signDisplay: "never" })}`,
      isOver ? "text-negative" : "text-ink",
    );
  }

  function renderReserveTile(r: BudgetStatusRow | undefined) {
    if (!r) return renderStatTile(undefined, "Reserve", "no reserves", "$0", "text-ink-faint");
    const bal = r.reserveBalance ?? 0;
    const isShort = bal < 0;
    return renderStatTile(
      r,
      "",
      "",
      `${isShort ? "−" : "+"}${formatCurrency(Math.abs(bal), { decimals: 0, signDisplay: "never" })}`,
      isShort ? "text-negative" : "text-positive",
    );
  }

  function sortRows(input: BudgetStatusRow[]): BudgetStatusRow[] {
    return [...input].sort((a, b) => {
      if (sort === "pct") {
        const pa = a.target > 0 ? a.effectiveSpend / a.target : 0;
        const pb = b.target > 0 ? b.effectiveSpend / b.target : 0;
        return pb - pa;
      }
      if (sort === "remaining") {
        const ra = a.target - a.effectiveSpend;
        const rb = b.target - b.effectiveSpend;
        return ra - rb;
      }
      if (sort === "name") {
        return a.category.localeCompare(b.category);
      }
      return b.target - a.target;
    });
  }

  return (
    <section className="pb-12">
      {/* flex-wrap so the controls drop to their own row on narrow phones
          instead of forcing the whole page wider than the viewport (which
          also throws off the fixed bottom nav). ml-auto keeps them
          right-aligned whether they share the title's row or wrap below. */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="text-[26px] font-bold tracking-tight">Budgets</h1>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <ModeToggle active={mode} />
          <SortToggle active={sort} />
          <ExpandAllToggle />
          <DateRangePicker from={dateRange.from} to={dateRange.to} />
        </div>
      </div>
      <div className="mb-5">
        <div className="flex items-baseline justify-between text-[13px] text-ink-muted">
          <span>
            <span className="font-semibold text-ink">Day {dayOfPeriod}</span> of {periodLength}
          </span>
          <span>
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left
          </span>
        </div>
        <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-hairline">
          <div
            className="animate-bar h-full rounded-full bg-ink-faint/60"
            style={{ width: `${Math.round((dayOfPeriod / periodLength) * 100)}%` }}
          />
        </div>
      </div>

      {/* Unified cashflow game-plan hero — actual-pace weeks + next-bills verdict,
          links into /forecast for the full scenario what-if. Replaces the old
          "Can I pay my bills?" card and the non-salaried runway hero. */}
      {cashflow && <CashflowHero result={cashflow} />}

      <PositionCard position={position} />

      {sweepNudge && (
        <SweepNudgeCard
          nudge={sweepNudge}
          bufferConfigured={result.reserveBuffer.accountId != null}
        />
      )}

      {/* Income pace assumes a salary to pace against — hide it once the salary
          has stopped (the cashflow game-plan is the relevant lens then). */}
      {incomeSeries.length > 0 && position.income.planned > 0 && salaried && (
        <div className="mb-3 rounded-card bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Income pace
            </span>
            <ExplainerTrigger explainer={explainIncomePace(position)} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-[26px] font-bold leading-none tabular-nums ${
                position.income.recentRunRate - position.income.planned >= 0 ? "text-positive" : "text-warning"
              }`}
            >
              {formatCurrency(position.income.recentRunRate - position.income.planned, {
                decimals: 0,
                signDisplay: "always",
              })}
            </span>
            <span className="text-[12px] text-ink-muted">
              /mo {position.income.recentRunRate - position.income.planned >= 0 ? "above" : "behind"} plan
            </span>
          </div>
          <div className="mt-3">
            <IncomePaceChart
              series={incomeSeries}
              planned={position.income.planned}
              expectedByNow={position.income.expectedByNow}
            />
          </div>
          <div className="mt-2.5 text-[11px] text-ink-faint">
            Trailing run-rate {formatCurrency(position.income.recentRunRate, { decimals: 0 })} · plan{" "}
            {formatCurrency(position.income.planned, { decimals: 0 })}/mo.
          </div>
        </div>
      )}

      <SpendingVsPlanCard position={position} categorised={categorisedInWindow} inboxCount={inboxInWindow} />

      {burn && burn.plannedPerDay > 0 && burn.dayOfPeriod > 0 && (
        <div className="mb-3 rounded-card bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Daily burn
            </span>
            <ExplainerTrigger explainer={explainDailyBurn(burn)} />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-[26px] font-bold leading-none tabular-nums ${
                burn.vsPlan <= 0 ? "text-positive" : "text-warning"
              }`}
            >
              {formatCurrency(burn.trailingPerDay, { decimals: 0 })}
            </span>
            <span className="text-[12px] text-ink-muted">
              /day · {formatCurrency(burn.vsPlan, { decimals: 0, signDisplay: "always" })}{" "}
              {burn.vsPlan <= 0 ? "under" : "over"} plan
              {burn.priorPerDay != null && (
                <span className="text-ink-faint">
                  {" · "}
                  {burn.trend > 0 ? "↑ rising" : burn.trend < 0 ? "↓ easing" : "flat"}
                </span>
              )}
            </span>
          </div>
          <div className="mt-3">
            <DailyBurnChart result={burn} />
          </div>
          <div className="mt-2.5 text-[11px] text-ink-faint">
            Trailing {burn.trailingDays}-day pace · plan{" "}
            {formatCurrency(burn.plannedPerDay, { decimals: 0 })}/day · spent{" "}
            {formatCurrency(burn.spentSoFar, { decimals: 0 })} of {burn.periodLength} days.
          </div>
        </div>
      )}

      <div className="mb-7 grid grid-cols-3 gap-2.5">
        <div className="rounded-card bg-surface p-4 shadow-card">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Flex
            <InfoSheet title="Flex balance">
              <div className="space-y-2 text-sm leading-relaxed text-ink-muted">
                <p>
                  Your combined headroom across monthly-cap categories you&apos;ve spent in. For
                  each one it adds up{" "}
                  <span className="font-medium text-ink">(monthly target &times; 3)</span> minus
                  what you&apos;ve actually spent over the last 3 cycles.
                </p>
                <p>
                  <span className="font-medium text-positive">Positive</span> means you&apos;re
                  under budget overall;{" "}
                  <span className="font-medium text-negative">negative</span> means you&apos;ve
                  overspent and can pull back elsewhere.
                </p>
              </div>
            </InfoSheet>
          </div>
          <div
            className={`mt-1 text-[21px] font-bold tabular-nums ${
              flex >= 0 ? "text-positive" : "text-negative"
            }`}
          >
            {formatCurrency(flex, { decimals: 0, signDisplay: "always" })}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-faint">
            {flexCategoriesIncluded} categor{flexCategoriesIncluded === 1 ? "y" : "ies"}
          </div>
        </div>
        {renderTopOverTile(topOverCap)}
        {renderReserveTile(lowestReserve)}
      </div>

      {(() => {
        function renderIncomeRow(r: BudgetStatusRow) {
          const target = r.target;
          // Income arrives as an inflow (the reimbursement leg), so received is
          // the net inflow = -netSpent. A negative value flags expense txns
          // miscategorised into an income category.
          const received = -r.netSpent;
          const pct = target > 0 ? (received / target) * 100 : 0;
          const onTrack = pct >= 100;
          const previews = r.recent;
          const txnsHref = `/transactions?category=${r.categoryId}&from=${dateRange.from}&to=${dateRange.to}`;
          return (
            <li key={r.categoryId} className="rounded-row bg-surface shadow-row">
              <details className="group" data-budget-row>
                <summary className="cursor-pointer p-[15px] marker:content-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-90" />
                      <Link href={txnsHref} className="truncate font-semibold text-ink hover:underline">
                        {r.category || "—"}
                      </Link>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindPillClass(
                          r.kind,
                        )}`}
                      >
                        {kindLabel(r.kind)}
                      </span>
                    </div>
                    <div className="tabular-nums text-[14px]">
                      <span className={onTrack ? "font-semibold text-positive" : "font-semibold text-ink"}>
                        {formatCurrency(received, { decimals: 0 })}
                      </span>
                      <span className="text-ink-faint"> / {formatCurrency(target, { decimals: 0, signDisplay: "never" })}</span>
                    </div>
                  </div>
                  <div className="relative mt-2.5 h-[7px] overflow-hidden rounded-full bg-sunken">
                    <div
                      className={`animate-bar h-full rounded-full ${incomeColor(pct)}`}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                </summary>
                <div className="px-[15px] pb-[15px]">
                  <div className="text-[12px] text-ink-muted">{pct.toFixed(0)}% of target</div>
                  <BudgetTrendChart series={historyMap.get(r.categoryId) ?? []} />
                  {previews.length > 0 && (
                    <div className="mt-3 rounded-control border border-hairline bg-sunken p-2.5 text-xs">
                      <div className="mb-1.5 text-ink-muted">Last {previews.length}:</div>
                      <ul className="space-y-1">
                        {previews.map((p) => {
                          const isOutflow = p.amount < 0;
                          return (
                            <li key={p.id} className="flex justify-between gap-2">
                              <span className="truncate text-ink">
                                <span className="text-ink-faint">
                                  {formatDateShort(p.occurred_at)}
                                </span>{" "}
                                {p.merchant ?? p.description ?? "—"}
                                {p.pending && (
                                  <span
                                    className="ml-1 text-ink-faint"
                                    title="Spent at the bank but not yet settled. Provisional — categorised from the pending description."
                                  >
                                    · pending
                                  </span>
                                )}
                              </span>
                              <span
                                className={`tabular-nums ${
                                  isOutflow ? "text-negative" : "text-positive"
                                }`}
                              >
                                {formatCurrency(p.amount, { signDisplay: "always" })}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <Link
                        href={txnsHref}
                        className="mt-2.5 inline-block font-medium text-accent hover:underline"
                      >
                        View all →
                      </Link>
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        }

        function renderBudgetRow(r: BudgetStatusRow) {
          if (r.kind === "income") return renderIncomeRow(r);
          const target = r.target;
          const isCap = r.kind === "monthly_cap";
          const isReserve = r.kind === "reserve";
          const isSavings = r.kind === "savings";
          const isAmortised = r.kind === "ap_amortised";
          const gross = r.spent;
          const reimb = r.reimbursed;
          // Auto-pay shows gross outflow; other kinds show net (gross − reimb).
          const spent = isAmortised ? r.spent : r.netSpent;
          const showReimb = !isAmortised && reimb > 0;
          const pct = r.pct;
          const isOver = r.status === "over";
          // Overshoot/reclaim bar geometry (only relevant when a reimbursement is
          // in play). Scale the track to the furthest point spend reached (gross),
          // then show the net resting point and the green amount clawed back.
          const maxExtent = Math.max(gross, target, 1);
          const netPos = Math.max(0, Math.min(100, (spent / maxExtent) * 100));
          const grossPos = Math.min(100, (gross / maxExtent) * 100);
          const targetPos = (target / maxExtent) * 100;
          const crossedLine = gross > target;
          // Reimbursements exceeded spend: nothing hit the budget on net.
          const inCredit = showReimb && spent < 0;
          const avg = r.avgMonthlySpend;
          const reserve = isReserve ? r.reserveBalance : null;
          const previews = r.recent;
          // Provisional pending (unsettled) spend attributed to this category by
          // the rule engine — answers "can I spend on this right now?" before the
          // charge settles. Drawn as a lighter segment past the settled fill and
          // annotated; the audited spent/pct/status stay settled-only.
          const pending = r.pendingSpent;
          const pendingPct = target > 0 ? (pending / target) * 100 : 0;
          const settledBarPct = Math.min(100, Math.max(0, pct));
          const pendingBarWidth = Math.max(0, Math.min(100 - settledBarPct, pendingPct));
          const txnsHref = `/transactions?category=${r.categoryId}&from=${dateRange.from}&to=${dateRange.to}`;
          return (
            <li key={r.categoryId} className="rounded-row bg-surface shadow-row">
              <details className="group" data-budget-row>
                <summary className="cursor-pointer p-[15px] marker:content-none [&::-webkit-details-marker]:hidden">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-90" />
                      <Link href={txnsHref} className="truncate font-semibold text-ink hover:underline">
                        {r.category || "—"}
                      </Link>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindPillClass(
                          r.kind,
                        )}`}
                      >
                        {kindLabel(r.kind)}
                      </span>
                    </div>
                    <div className="tabular-nums text-[14px]">
                      {showReimb && (
                        <span className="mr-1 text-ink-faint line-through">
                          {formatCurrency(gross, { decimals: 0, signDisplay: "never" })}
                        </span>
                      )}
                      {inCredit ? (
                        <span className="font-semibold text-positive">
                          {formatCurrency(Math.abs(spent), { decimals: 0, signDisplay: "always" })} credit
                        </span>
                      ) : (
                        <span
                          className={
                            isOver
                              ? "font-semibold text-negative"
                              : isSavings && pct >= 100
                                ? "font-semibold text-positive"
                                : "font-semibold text-ink"
                          }
                        >
                          {formatCurrency(spent, { decimals: 0, signDisplay: "never" })}
                        </span>
                      )}
                      <span className="text-ink-faint"> / {formatCurrency(target, { decimals: 0, signDisplay: "never" })}</span>
                      {pending > 0 && (
                        <span
                          className="ml-1 whitespace-nowrap text-[11px] text-warning"
                          title="Spent at the bank but not yet settled. Provisional — categorised from the pending description."
                        >
                          +{formatCurrency(pending, { decimals: 0, signDisplay: "never" })} pending
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative mt-2.5 h-[7px] overflow-hidden rounded-full bg-sunken">
                    {inCredit ? (
                      // fully reimbursed — in credit, nothing consumed on net
                      <div className="h-full w-full bg-positive-weak" />
                    ) : showReimb ? (
                      <>
                        {/* reclaim tail: from net resting point out to gross — money clawed back */}
                        <div
                          className="absolute inset-y-0 bg-positive-bar/60"
                          style={{ left: `${netPos}%`, width: `${Math.max(0, grossPos - netPos)}%` }}
                        />
                        {/* net spend: what actually hit the budget */}
                        <div
                          className={`absolute inset-y-0 left-0 ${progressColor(r.status)}`}
                          style={{ width: `${netPos}%` }}
                        />
                        {/* budget line — visible only once spend crossed it */}
                        {crossedLine && (
                          <div
                            className="absolute inset-y-0 w-px bg-ink-strong/70"
                            style={{ left: `${targetPos}%` }}
                          />
                        )}
                      </>
                    ) : (
                      <>
                        <div
                          className={`animate-bar h-full rounded-full ${isSavings ? savingsColor(pct) : progressColor(r.status)}`}
                          style={{ width: `${settledBarPct}%` }}
                        />
                        {/* provisional pending: lighter striped segment past the settled fill */}
                        {pendingBarWidth > 0 && (
                          <div
                            className="absolute inset-y-0 bg-warning/40"
                            style={{ left: `${settledBarPct}%`, width: `${pendingBarWidth}%` }}
                          />
                        )}
                      </>
                    )}
                  </div>
                </summary>
                <div className="px-[15px] pb-[15px]">
                  <div className="flex items-center justify-between text-[12px] text-ink-muted">
                    <span>
                      {inCredit
                        ? "in credit"
                        : isSavings
                          ? `set aside ${formatCurrency(spent, { decimals: 0, signDisplay: "never" })} of ${formatCurrency(target, { decimals: 0, signDisplay: "never" })} this cycle`
                          : `${pct.toFixed(0)}% used`}
                      {!inCredit && r.projected != null && <> · on pace {formatCurrency(r.projected, { decimals: 0, signDisplay: "never" })}</>}
                      {isCap && avg > 0 && <> · 3-mo avg {formatCurrency(avg, { decimals: 0, signDisplay: "never" })}/mo</>}
                      {r.priorSpend > 0 && (
                        <span className="text-ink-faint"> · last period {formatCurrency(r.priorSpend, { decimals: 0, signDisplay: "never" })}</span>
                      )}
                      {showReimb && (
                        <span className="text-positive">
                          {" · "}gross {formatCurrency(gross, { decimals: 0, signDisplay: "never" })}, {formatCurrency(reimb, { decimals: 0, signDisplay: "never" })} reimb
                        </span>
                      )}
                      {pending > 0 && (
                        <span className="text-warning">
                          {" · "}{formatCurrency(spent + pending, { decimals: 0, signDisplay: "never" })} incl. pending ({pct >= 0 && target > 0 ? `${Math.round(((spent + pending) / target) * 100)}%` : "—"})
                        </span>
                      )}
                    </span>
                    {reserve !== null && (
                      <span
                        className={`tabular-nums ${
                          reserve < 0 ? "text-negative" : "text-positive"
                        }`}
                      >
                        balance {formatCurrency(reserve, { decimals: 0, signDisplay: "always" })}
                      </span>
                    )}
                  </div>
                  <BudgetTrendChart series={historyMap.get(r.categoryId) ?? []} />
                  {previews.length > 0 && (
                    <div className="mt-3 rounded-control border border-hairline bg-sunken p-2.5 text-xs">
                      <div className="mb-1.5 text-ink-muted">Last {previews.length}:</div>
                      <ul className="space-y-1">
                        {previews.map((p) => {
                          const isOutflow = p.amount < 0;
                          return (
                            <li key={p.id} className="flex justify-between gap-2">
                              <span className="truncate text-ink">
                                <span className="text-ink-faint">
                                  {formatDateShort(p.occurred_at)}
                                </span>{" "}
                                {p.merchant ?? p.description ?? "—"}
                                {p.pending && (
                                  <span
                                    className="ml-1 text-ink-faint"
                                    title="Spent at the bank but not yet settled. Provisional — categorised from the pending description."
                                  >
                                    · pending
                                  </span>
                                )}
                              </span>
                              <span
                                className={`tabular-nums ${
                                  isOutflow ? "text-negative" : "text-positive"
                                }`}
                              >
                                {formatCurrency(p.amount, { signDisplay: "always" })}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <Link
                        href={txnsHref}
                        className="mt-2.5 inline-block font-medium text-accent hover:underline"
                      >
                        View all →
                      </Link>
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        }

        function renderGroups(sections: { heading: string; rows: BudgetStatusRow[] }[]) {
          return sections
            .filter((s) => s.rows.length > 0)
            .map(({ heading, rows: rawRows }) => {
              const sorted = sortRows(rawRows);
              return (
                <details key={heading} open className="group/section mb-7">
                  <summary className="mb-3 flex cursor-pointer items-center gap-2 marker:content-none [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="h-3 w-3 shrink-0 text-ink-faint transition-transform duration-200 group-open/section:rotate-90" />
                    <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
                      {heading}
                    </h2>
                    <span className="text-[11px] tabular-nums text-ink-faint">{sorted.length}</span>
                  </summary>
                  <ul className="space-y-2.5">{sorted.map(renderBudgetRow)}</ul>
                </details>
              );
            });
        }

        if (mode === "category") {
          return renderGroups(
            orderedGroups.map((g) => ({ heading: g, rows: grouped.get(g)! })),
          );
        }

        if (mode === "type") {
          const byKind = new Map<string, BudgetStatusRow[]>();
          for (const r of rows) {
            const k = r.kind ?? "other";
            if (!byKind.has(k)) byKind.set(k, []);
            byKind.get(k)!.push(r);
          }
          const orderedKinds = [
            ...KIND_ORDER.filter((k) => byKind.has(k)),
            ...Array.from(byKind.keys()).filter((k) => !KIND_ORDER.includes(k)),
          ];
          return renderGroups(
            orderedKinds.map((k) => ({
              heading: KIND_LABEL[k] ?? k,
              rows: byKind.get(k)!,
            })),
          );
        }

        // flow mode: income (kind === "income") vs expenses
        const income: BudgetStatusRow[] = [];
        const expenses: BudgetStatusRow[] = [];
        for (const r of rows) {
          (r.kind === "income" ? income : expenses).push(r);
        }
        return renderGroups([
          { heading: "Income", rows: income },
          { heading: "Expenses", rows: expenses },
        ]);
      })()}
    </section>
  );
}
