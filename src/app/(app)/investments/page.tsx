import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { scopedDb } from "@/lib/supabase/scoped";
import { getCachedNetWorth } from "@/lib/networth/cached";
import { getCachedMortgagePI } from "@/lib/mortgage/cached";
import AllocationPanel from "./allocation-panel";
import { loadAllocationInput } from "@/lib/allocation/load";
import type { AllocationInput } from "@/lib/allocation/compute";
import { buildNetWorthTrend, type SnapshotRecord } from "@/lib/networth/trend";
import { summarisePortfolio, type AccountHoldings } from "@/lib/holdings/group";
import { getCachedInvestments } from "@/lib/holdings/cached";
import { InceptionEditor } from "./inception-editor";
import { NetWorthChart } from "@/components/net-worth-chart";
import { ChevronRight } from "@/components/icons";
import { formatCurrency, formatMonthYear } from "@/lib/format";
import { getCachedFI } from "@/lib/fi/cached";
import { FISection } from "@/components/fi-section";
import { computeEmergencyFund } from "@/lib/buffer/compute";
import { EmergencyFundCard } from "@/components/emergency-fund-card";

export const dynamic = "force-dynamic";

// How far back the trend chart reaches. Snapshots only began accruing once the
// M5 nightly cron shipped, so early on this will simply show what exists.
const TREND_DAYS = 90;

// Whole-dollar NZD headline figures.
const nzd = (n: number) => formatCurrency(n, { decimals: 0 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Format an ISO `yyyy-mm-dd` snapshot date as "4 Jun" from its parts — never via
// Date(), which parses the string as UTC midnight and can shift a day under NZ TZ.
const fmtSnapshotDate = (iso: string): string => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
// Native-currency money for a single fund: 2dp, with the code appended when it
// isn't NZD so a USD line never reads as dollars-and-cents NZD.
const money = (n: number, currency: string) => formatCurrency(n, { decimals: 2, currency });

function accountTypeLabel(type: string): string {
  if (type === "kiwisaver") return "KiwiSaver";
  if (type === "investment") return "Investments";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export default async function InvestmentsPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const db = scopedDb(supabase, householdId);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - TREND_DAYS);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  const [netWorth, mortgage, snapsRes, groupsResult] = await Promise.all([
    getCachedNetWorth(householdId),
    getCachedMortgagePI(householdId),
    db.net_worth_snapshots
      .select("snapshot_date, assets, liabilities, net")
      .gte("snapshot_date", cutoffISO)
      .order("snapshot_date", { ascending: true }),
    getCachedInvestments(householdId).then(
      (data) => ({ data, error: null as string | null }),
      (e) => ({ data: [] as AccountHoldings[], error: e instanceof Error ? e.message : String(e) }),
    ),
  ]);

  if (snapsRes.error) return <p className="text-sm text-negative">Error: {snapsRes.error.message}</p>;
  if (groupsResult.error) return <p className="text-sm text-negative">Error: {groupsResult.error}</p>;

  const trend = buildNetWorthTrend((snapsRes.data ?? []) as SnapshotRecord[]);
  const groups = groupsResult.data;
  const portfolio = summarisePortfolio(groups);

  const { net, assets, liabilities } = netWorth;
  // computeNetWorth reports liabilities as a negative total; show it as a
  // magnitude under an explicit "owed" label.
  const owed = Math.abs(liabilities);

  // Independent supplemental computes — run them concurrently rather than serially.
  // Each swallows its own failure: `fi` is a supplemental section, `allocation`
  // just leaves the panel unrendered if its inputs can't be assembled.
  const [fi, allocation, emergency] = await Promise.all([
    getCachedFI(householdId).catch(
      () => null as Awaited<ReturnType<typeof getCachedFI>> | null,
    ),
    loadAllocationInput({ supabase, householdId }).catch(() => null as AllocationInput | null),
    computeEmergencyFund({ supabase, householdId }).catch(
      () => null as Awaited<ReturnType<typeof computeEmergencyFund>> | null,
    ),
  ]);

  return (
    <section className="pb-12">
      <h1 className="mb-5 text-[26px] font-bold tracking-tight">Net worth</h1>

      <div className="mb-6 rounded-card bg-surface p-5 shadow-card">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          Total net worth
        </div>
        <div
          className={`mt-1 text-[44px] font-bold leading-none tabular-nums tracking-tight ${
            net >= 0 ? "text-ink" : "text-negative"
          }`}
        >
          {nzd(net)}
        </div>

        {trend.points.length >= 2 ? (
          <>
            <div className="mt-4">
              <NetWorthChart points={trend.points} />
            </div>
            <div className="mt-2 text-[12px] tabular-nums">
              <span className={trend.change >= 0 ? "text-positive" : "text-negative"}>
                {trend.change >= 0 ? "▲" : "▼"} {nzd(Math.abs(trend.change))}
                {trend.changePct != null && <> ({trend.changePct >= 0 ? "+" : "−"}
                  {Math.abs(trend.changePct).toFixed(1)}%)</>}
              </span>
              {trend.earliest && (
                <span className="text-ink-faint"> · since {fmtSnapshotDate(trend.earliest.date)}</span>
              )}
            </div>
          </>
        ) : (
          <div className="mt-3 text-[12px] text-ink-faint">
            Trend builds as daily snapshots accrue.
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-hairline pt-3 text-[13.5px] tabular-nums">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-positive-bar" />
            <span className="text-ink-muted">Assets</span>
            <span className="ml-auto font-semibold text-ink">{nzd(assets)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-negative-bar" />
            <span className="text-ink-muted">Owed</span>
            <span className="ml-auto font-semibold text-ink">{nzd(owed)}</span>
          </div>
        </div>
      </div>

      {emergency && (
        <div className="mb-6">
          <EmergencyFundCard fund={emergency} />
        </div>
      )}

      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
        Holdings
      </h2>
      {groups.length > 0 && renderPortfolioSummary()}
      {groups.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No holdings yet. They sync nightly from connected investment and KiwiSaver accounts.
        </p>
      ) : (
        <ul className="space-y-2.5">{groups.map((g) => renderAccount(g))}</ul>
      )}

      {mortgage.parts.length > 0 && renderMortgage()}

{fi && fi.fiNumber > 0 && <FISection fi={fi} />}
    </section>
  );

  // Whole-portfolio headline: total invested value + a value-weighted blend of
  // the per-account annualised (and cumulative) returns. Currency-safe because we
  // blend the percentage rates by NZD value rather than summing native cost bases.
  function renderPortfolioSummary() {
    const ann = portfolio.annualisedPct;
    const cum = portfolio.returnPct;
    const partial =
      ann != null && portfolio.annualisedCoverageNZD < portfolio.valueNZD;
    return (
      <div className="mb-3 rounded-card bg-surface p-4 shadow-card">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Invested
          </span>
          <span className="font-semibold tabular-nums text-ink">{nzd(portfolio.valueNZD)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 tabular-nums">
          {ann != null ? (
            <span
              className={`text-[26px] font-bold leading-none ${
                ann >= 0 ? "text-positive" : "text-negative"
              }`}
            >
              {ann >= 0 ? "+" : "−"}
              {Math.abs(ann).toFixed(1)}%
              <span className="ml-1 text-[12px] font-medium text-ink-faint">/ yr</span>
            </span>
          ) : (
            <span className="text-[13px] text-ink-faint">
              Set account start dates to see annualised growth
            </span>
          )}
          {cum != null && (
            <span className="text-[12px] text-ink-muted">
              {ann != null ? "· " : ""}
              {cum >= 0 ? "+" : "−"}
              {Math.abs(cum).toFixed(1)}% total
            </span>
          )}
        </div>
        {partial && (
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Annualised across {nzd(portfolio.annualisedCoverageNZD)} of {nzd(portfolio.valueNZD)} — set a start date on the rest below.
          </p>
        )}
      </div>
    );
  }

  // Mortgage P&I — a read-only FI lens (interest vs equity), separate from the
  // budget page, which intentionally counts the gross repayment as spend. Tagged
  // "Proposed" while the model is reviewed. Payoff is an estimate (see spec).
  function renderMortgage() {
    const t = mortgage.totals;
    return (
      <>
        <div className="mb-3 mt-8 flex items-center gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">
            Mortgage · {mortgage.year}
          </h2>
          <span className="rounded-md bg-sunken px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
            Proposed
          </span>
        </div>

        <div className="rounded-card bg-surface p-5 shadow-card">
          <div className="grid grid-cols-2 gap-3 text-[13.5px] tabular-nums">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                Interest paid YTD
              </div>
              <div className="mt-0.5 text-[22px] font-bold leading-none text-ink">{nzd(t.interestYtd)}</div>
              <div className="mt-0.5 text-[11px] text-ink-faint">cost of borrowing</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                Principal repaid YTD
              </div>
              <div className="mt-0.5 text-[22px] font-bold leading-none text-positive">{nzd(t.principalYtd)}</div>
              <div className="mt-0.5 text-[11px] text-ink-faint">equity built</div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3 text-[13px] tabular-nums">
            <span className="text-ink-muted">Owing</span>
            <span className="font-semibold text-ink">{nzd(t.balance)}</span>
          </div>
          {t.otherInterestYtd > 0 && (
            <div className="mt-1 flex items-center justify-between text-[12px] tabular-nums text-ink-faint">
              <span>Interest-only / revolving interest YTD</span>
              <span>{nzd(t.otherInterestYtd)}</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between text-[12px] tabular-nums">
            <span className="text-ink-muted">
              Mortgage-free ({mortgage.estimated ? "est." : "contractual"}, current rate &amp; payment)
            </span>
            <span className="font-medium text-ink">{formatMonthYear(mortgage.payoff.freeDate)}</span>
          </div>

          <ul className="mt-3 divide-y divide-hairline border-t border-hairline">
            {mortgage.parts.map((p) => (
              <li key={p.name} className="flex flex-col gap-0.5 py-2 text-[13px] tabular-nums">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-ink">{p.loanAccountName ?? p.name}</span>
                  <span className="shrink-0 text-right font-medium text-ink-muted">{nzd(p.balance)}</span>
                </div>
                {p.ratePct || p.fixedUntil || p.payoff?.freeDate ? (
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[12px] text-ink-faint">
                    {p.ratePct ? (
                      <span>
                        {p.ratePct}%{p.rateSource === "estimated" ? "~" : ""}
                      </span>
                    ) : null}
                    {p.fixedUntil ? <span>fixed→{p.fixedUntil}</span> : null}
                    {p.payoff?.freeDate ? <span>free ~{formatMonthYear(p.payoff.freeDate)}</span> : null}
                  </div>
                ) : null}
              </li>
            ))}
            {mortgage.revolving.map((rv) => (
              <li key={rv.accountId} className="flex items-center justify-between gap-3 py-2 text-[13px] tabular-nums">
                <span className="min-w-0 truncate text-ink">
                  {rv.name}
                  <span className="ml-1 text-[11px] text-warning">interest-only</span>
                </span>
                <span className="shrink-0 text-right text-ink-muted">{nzd(rv.balance)}</span>
              </li>
            ))}
          </ul>

          {mortgage.revolving.length > 0 && (
            <p className="mt-2 text-[11px] leading-snug text-warning">
              The revolving facility is interest-only — it never self-clears; set a repayment to pay it down.
            </p>
          )}
          <p className="mt-2 text-[11px] leading-snug text-ink-faint">
            {mortgage.estimated
              ? "Rate/payoff estimated from your repayments and posted interest. "
              : "Rate and term from your loan details. "}
            Payoff assumes today&apos;s rate and payment hold until your next refix.
          </p>
        </div>

        {/* Only when the baseline payoff is projectable — otherwise the card above
            shows "—" and a confident what-if baseline would contradict it. */}
        {allocation && mortgage.payoff.freeDate != null && (
          <AllocationPanel base={allocation} />
        )}
      </>
    );
  }

  function renderAccount(g: AccountHoldings) {
    const value = g.balanceNZD ?? g.totalValue;
    const ret = g.totalReturn;
    const showReturn = g.currency !== null; // suppress native totals if mixed
    return (
      <li key={g.accountId} className="rounded-row bg-surface shadow-row">
        <details className="group" open>
          <summary className="cursor-pointer p-[15px] marker:content-none [&::-webkit-details-marker]:hidden">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 group-open:rotate-90" />
                <span className="truncate font-semibold text-ink">{g.accountName}</span>
                <span className="shrink-0 rounded-md bg-sunken px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {accountTypeLabel(g.accountType)}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums text-ink">{nzd(value)}</div>
                {showReturn ? (
                  <div
                    className={`text-[11px] tabular-nums ${
                      ret >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {formatCurrency(ret, { decimals: 0, signDisplay: "always" })}
                    {g.returnPct != null && <> ({g.returnPct >= 0 ? "+" : "−"}
                      {Math.abs(g.returnPct).toFixed(1)}%)</>}
                  </div>
                ) : (
                  // Mixed currency: the native dollar total can't be summed
                  // across currencies, but the value-weighted blended % can.
                  g.returnPct != null && (
                    <div
                      className={`text-[11px] tabular-nums ${
                        g.returnPct >= 0 ? "text-positive" : "text-negative"
                      }`}
                    >
                      {g.returnPct >= 0 ? "+" : "−"}
                      {Math.abs(g.returnPct).toFixed(1)}%
                      <span className="ml-1 text-ink-faint">blended</span>
                    </div>
                  )
                )}
                {g.annualisedPct != null && (
                  <div
                    className={`text-[10px] font-medium tabular-nums ${
                      g.annualisedPct >= 0 ? "text-positive" : "text-negative"
                    }`}
                  >
                    {g.annualisedPct >= 0 ? "+" : "−"}
                    {Math.abs(g.annualisedPct).toFixed(1)}% / yr
                  </div>
                )}
              </div>
            </div>
          </summary>
          <div className="px-[15px] pb-[12px]">
            <ul className="divide-y divide-hairline">
              {g.holdings.map((fund) => {
                const pct = fund.returnPct;
                return (
                  <li key={fund.fundId} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] text-ink">{fund.name}</div>
                      <div className="text-[11px] text-ink-faint tabular-nums">
                        {fund.symbol ? `${fund.symbol} · ` : ""}
                        {fund.shares != null
                          ? `${fund.shares.toLocaleString("en-NZ", { maximumFractionDigits: 4 })} units`
                          : "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-[13.5px] font-medium text-ink">
                        {money(fund.value, fund.currency)}
                      </div>
                      <div
                        className={`text-[11px] ${
                          fund.returns >= 0 ? "text-positive" : "text-negative"
                        }`}
                      >
                        {formatCurrency(fund.returns, { decimals: 2, currency: fund.currency, signDisplay: "always" })}
                        {pct != null && <> ({pct >= 0 ? "+" : "−"}{Math.abs(pct).toFixed(1)}%)</>}
                      </div>
                      {fund.annualisedPct != null && (
                        <div className="text-[10px] text-ink-faint tabular-nums">
                          {fund.annualisedPct >= 0 ? "+" : "−"}
                          {Math.abs(fund.annualisedPct).toFixed(1)}% / yr
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {!showReturn && (
              <p className="mt-2 text-[11px] text-ink-faint">
                Mixed-currency account — totals shown per fund in native currency.
              </p>
            )}
            <InceptionEditor
              accountId={g.accountId}
              inception={g.inception}
              inceptionSource={g.inceptionSource}
            />
          </div>
        </details>
      </li>
    );
  }
}
