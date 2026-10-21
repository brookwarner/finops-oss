"use client";

import { useState } from "react";
import { ChevronRight } from "@/components/icons";
import { InfoSheet } from "@/components/info-sheet";
import { projectFI } from "@/lib/fi/compute";
import { REAL_RETURN, DOB, FI_TARGET_AGE } from "@/lib/fi/constants";
import { formatCurrency } from "@/lib/format";
import { FIChart } from "@/components/fi-chart";
import type { computeFI } from "@/lib/fi/compute";

type FI = Awaited<ReturnType<typeof computeFI>>;

export function FISection({ fi }: { fi: FI }) {
  const [realReturn, setRealReturn] = useState(REAL_RETURN);
  if (fi.fiNumber <= 0) return null;

  const now = new Date();
  const projection = projectFI({
    startAssets: fi.fiAssets,
    monthlyContribution: fi.monthlyContribution,
    realAnnualReturn: realReturn,
    fiNumber: fi.fiNumber,
    now,
    dob: DOB,
  });

  const rMonthly = Math.pow(1 + realReturn, 1 / 12) - 1;
  const horizon = projection.months != null ? Math.min(projection.months + 6, 600) : 600;
  const points: number[] = [];
  let a = fi.fiAssets;
  points.push(a);
  for (let m = 1; m <= horizon; m++) {
    a = a * (1 + rMonthly) + fi.monthlyContribution;
    points.push(a);
  }
  const fiYear = projection.fiDate ? Number(projection.fiDate.slice(0, 4)) : null;
  const vsTarget = projection.fiAge != null ? projection.fiAge - FI_TARGET_AGE : null;
  const savedNothing = fi.monthlyContribution <= 0;
  const cumulative = fi.assumptions.actualReturnPct * 100;
  const annualised =
    fi.assumptions.actualReturnAnnualisedPct != null
      ? fi.assumptions.actualReturnAnnualisedPct * 100
      : null;

  const fiLegend: { line: string; meaning: string }[] = [
    {
      line: "FI: % there",
      meaning: `Your FI assets (${formatCurrency(fi.fiAssets, { decimals: 0, signDisplay: "never" })}) as a share of the ${formatCurrency(fi.fiNumber, { decimals: 0, signDisplay: "never" })} you need to never have to earn again. 100% = financially independent.`,
    },
    {
      line: "On track?",
      meaning: `Compounding today's savings + assets at ${(realReturn * 100).toFixed(1)}% real return (the slider) until they reach your FI number. Your goal is age ${fi.targetAge} (${fi.targetYear}).`,
    },
    {
      line: "FI number (target)",
      meaning: `FI number = your recurring annual spend ÷ ${Math.round(fi.assumptions.swr * 100)}% (the safe-withdrawal rule). It's the invested pot whose returns cover your living costs forever. Mortgage interest counts; principal, sinking funds and one-offs don't.`,
    },
    {
      line: "Monthly saved",
      meaning: `The money you actually moved into savings + investments over the last ${fi.assumptions.contributionWindowMonths} months — bank deposits plus Sharesies/Investments contributions, counted from the cash leaving your account (so market swings don't distort it). Not income minus expenses; creep-proof.`,
    },
    {
      line: "Portfolio return",
      meaning: `A backward-looking reality check on your investment portfolio (excludes locked KiwiSaver), not part of the forward projection. Annualised is the compound per-year growth rate your cumulative since-purchase return works out to — a rough sense-check against the ${(realReturn * 100).toFixed(1)}% slider (note this rate is nominal, before inflation, whereas the slider is a real return).`,
    },
  ];

  const onTrack =
    projection.reached && projection.fiAge != null
      ? `on track for ~${projection.fiDate} (age ${projection.fiAge})`
      : "not on track within 50 years at this savings rate";
  const vs =
    vsTarget == null ? "" :
    vsTarget <= 0 ? ` · ${Math.abs(vsTarget)} yr${Math.abs(vsTarget) === 1 ? "" : "s"} early` :
    ` · ${vsTarget} yr${vsTarget === 1 ? "" : "s"} past your age-${FI_TARGET_AGE} goal`;

  return (
    <section className="mt-8">
      <div className="mb-1.5 flex items-center gap-1.5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">Financial independence</h2>
        <InfoSheet title="Financial independence" answers="What every number on this card means">
          <p className="mb-4 text-sm leading-snug text-ink-muted">
            FI = the point where your liquid invested money (savings + investments, excluding the
            home and locked KiwiSaver) throws off enough each year to cover your recurring living
            costs forever — so earning becomes optional. Everything here is derived from your actual
            transactions, in today&apos;s dollars.
          </p>
          <dl className="space-y-3.5">
            {fiLegend.map((row) => (
              <div
                key={row.line}
                className="border-t border-hairline pt-3.5"
              >
                <dt className="text-sm font-semibold tabular-nums text-ink">{row.line}</dt>
                <dd className="mt-0.5 text-sm leading-snug tabular-nums text-ink-muted">
                  {row.meaning}
                </dd>
              </div>
            ))}
          </dl>
        </InfoSheet>
      </div>
      <p className="mb-3 text-[12px] italic leading-snug text-ink-muted">
        At your actual current spending and saving rate, at what age does your liquid invested money become self-sustaining — and is that before or after {fi.targetAge}?
      </p>
      <div className="rounded-card bg-surface p-5 shadow-card">
        <p className="text-[22px] font-bold leading-tight text-ink">
          FI: {Math.round(fi.pctToFI * 100)}% there
        </p>
        <p className={`mt-1 text-[13px] ${projection.reached ? "text-ink-muted" : "text-warning"}`}>
          {onTrack}{vs}
        </p>

        <FIChart points={points} target={fi.fiNumber} reachedMonth={projection.months} fiYear={fiYear} className="mt-4 h-28 w-full" />

        <div className="mt-3 flex items-center gap-3">
          <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">Return</label>
          <input
            type="range" min={0} max={0.08} step={0.005} value={realReturn}
            onChange={(e) => setRealReturn(Number(e.target.value))}
            className="flex-1 accent-[rgb(var(--positive))]"
          />
          <span className="w-16 text-right text-[13px] tabular-nums text-ink">{(realReturn * 100).toFixed(1)}% real</span>
        </div>

        <p className="mt-3 text-[13px] tabular-nums text-ink-muted">
          {formatCurrency(fi.fiNumber, { decimals: 0 })} target{" "}
          (~{formatCurrency(fi.annualRecurringSpend, { decimals: 0, signDisplay: "never" })}/yr recurring ÷ {Math.round(fi.assumptions.swr * 100)}%)
        </p>
        <p className={`mt-1 text-[13px] tabular-nums ${savedNothing ? "text-warning" : "text-positive"}`}>
          {savedNothing
            ? `Nothing moved to savings in the last ${fi.assumptions.contributionWindowMonths} months`
            : `${formatCurrency(fi.monthlyContribution, { decimals: 0, signDisplay: "never" })}/mo actually saved (trailing ${fi.assumptions.contributionWindowMonths}mo)`}
        </p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-[13px] tabular-nums text-ink-muted">
          <span>Your portfolio:</span>
          {annualised != null ? (
            <>
              <span className={annualised >= 0 ? "font-semibold text-positive" : "font-semibold text-negative"}>
                {annualised >= 0 ? "+" : "−"}{Math.abs(annualised).toFixed(1)}%/yr
              </span>
              <span>annualised</span>
              <span className="text-ink-faint">
                · {cumulative >= 0 ? "+" : "−"}{Math.abs(cumulative).toFixed(1)}% total since purchase
              </span>
            </>
          ) : (
            <>
              <span>{cumulative >= 0 ? "+" : "−"}{Math.abs(cumulative).toFixed(1)}% since purchase</span>
              <span className="text-ink-faint">(cumulative — set account start dates above for annualised)</span>
            </>
          )}
        </p>

        <details className="group mt-4">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint marker:content-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3 w-3 shrink-0 transition-transform duration-200 group-open:rotate-90" />
            What this is based on
          </summary>
          <div className="mt-2 space-y-2 border-t border-hairline pt-3 text-[12px] text-ink-muted">
            <p><span className="text-ink">Assumptions:</span> {Math.round(fi.assumptions.swr * 100)}% safe withdrawal · {(realReturn * 100).toFixed(1)}% real return (slider) · target age {fi.targetAge} ({fi.targetYear}).</p>
            <p><span className="text-ink">FI assets ({formatCurrency(fi.fiAssets, { decimals: 0, signDisplay: "never" })}):</span> {fi.assumptions.fiAssetAccounts.map((acc) => `${acc.name} ${formatCurrency(acc.balance, { decimals: 0, signDisplay: "never" })}`).join(" · ") || "none"}.</p>
            <p><span className="text-ink">Saved (trailing {fi.assumptions.contributionWindowMonths}mo):</span> {fi.assumptions.contributionByAccount.map((acc) => `${acc.name} ${formatCurrency(acc.net, { decimals: 0 })}`).join(" · ") || "no movements detected"}.</p>
            <p><span className="text-ink">KiwiSaver:</span> {formatCurrency(fi.assumptions.kiwiSaverBalance, { decimals: 0, signDisplay: "never" })} — excluded until 65 (locked).</p>
            <p className="text-ink-faint">{fi.assumptions.spendBasis}</p>
            <p className="text-ink-faint">All in today&apos;s dollars. Auto-derived from your accounts and transactions.</p>
          </div>
        </details>
      </div>
    </section>
  );
}
