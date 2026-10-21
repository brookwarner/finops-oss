"use client";

import { useMemo, useState } from "react";
import { computeAllocation, durationLabel, type AllocationInput, type Rung } from "@/lib/allocation/compute";
import { ChevronRight } from "@/components/icons";
import { InfoSheet } from "@/components/info-sheet";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-NZ")}`;

interface LeverProps {
  name: string; sub: string; value: number; onChange: (v: number) => void;
  step: number; min: number; max: number; prefix?: string;
}

// Lifted verbatim from the former mortgage-scenario-panel.tsx so the keystroke/
// draft/stepper behaviour is preserved (clear-and-retype without snapping to min).
function Lever({ name, sub, value, onChange, step, min, max, prefix }: LeverProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (Number.isFinite(value) ? value.toFixed(0) : "");
  const commit = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "");
    if (cleaned === "" || cleaned === ".") { onChange(min); return; }
    const n = Number(cleaned);
    onChange(Number.isFinite(n) ? clamp(n) : min);
  };
  const stepTo = (v: number) => { setDraft(null); onChange(clamp(v)); };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13.5px] text-ink">{name}</div>
        <div className="mt-0.5 text-[11px] text-ink-faint">{sub}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" aria-label={`Decrease ${name}`} onClick={() => stepTo(value - step)} className="h-7 w-7 rounded-md bg-sunken text-ink-muted active:bg-hairline">−</button>
        <div className="flex items-center rounded-md border border-hairline bg-sunken px-2 py-1">
          {prefix && <span className="text-[13px] text-ink-faint">{prefix}</span>}
          <input inputMode="decimal" aria-label={name} value={display}
            onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
            onBlur={() => setDraft(null)}
            className="w-[72px] bg-transparent text-right text-[14px] tabular-nums text-ink outline-none" />
        </div>
        <button type="button" aria-label={`Increase ${name}`} onClick={() => stepTo(value + step)} className="h-7 w-7 rounded-md bg-sunken text-ink-muted active:bg-hairline">+</button>
      </div>
    </div>
  );
}

const TAG_CLS: Record<Rung["tag"]["cls"], string> = {
  guaranteed: "bg-positive-weak text-positive",
  need: "bg-reserve-weak text-reserve",
  risky: "bg-sunken text-ink-muted",
};

function RungRow({ rung, last }: { rung: Rung; last: boolean }) {
  return (
    <>
      <details className="group rounded-row border border-hairline bg-sunken/40 px-3 py-2.5">
        <summary className="flex cursor-pointer items-center justify-between marker:content-none [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-open:rotate-90" />
            <span className="truncate">{rung.title}</span>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] ${TAG_CLS[rung.tag.cls]}`}>{rung.tag.text}</span>
          </span>
          <span className="shrink-0 font-semibold tabular-nums text-positive">{rung.amount > 0 ? `$${Math.round(rung.amount)}` : "$0"}</span>
        </summary>
        <div className="mt-2.5 border-t border-hairline pt-2.5">
          {rung.detail.lines.map((l) => (
            <div key={l.label} className="flex justify-between py-0.5 text-[11.5px] text-ink-muted tabular-nums">
              <span>{l.label}</span><span>{l.value}</span>
            </div>
          ))}
          <p className="mt-2 rounded-md bg-sunken px-2.5 py-2 text-[11px] leading-relaxed text-ink-faint">{rung.detail.why}</p>
        </div>
      </details>
      {!last && <div className="py-0.5 text-center text-[13px] leading-none text-ink-faint">▾</div>}
    </>
  );
}

// One side of the final mortgage-vs-invest fork. Shows the dollars routed (the
// winner gets the spare, the other $0) and that path's FI outcome.
function ForkCard({
  title, routed, chosen, fiDate, fiAge, fiReached, sub,
}: {
  title: string; routed: number; chosen: boolean;
  fiDate: string | null; fiAge: number | null; fiReached: boolean; sub: string;
}) {
  return (
    <div className={`rounded-row border px-3 py-2.5 ${chosen ? "border-positive/40 bg-positive-weak/40" : "border-hairline bg-sunken/40"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-semibold text-ink">{title}</span>
        <span className={`shrink-0 text-[12px] font-bold tabular-nums ${chosen ? "text-positive" : "text-ink-faint"}`}>
          {chosen ? money(routed) : "$0"}
        </span>
      </div>
      <div className="mt-1 text-[15px] font-bold leading-tight tabular-nums text-ink">
        {fiReached && fiDate ? (
          <>FI {fiDate}<span className="ml-1 text-[11px] font-medium text-ink-faint">age {fiAge}</span></>
        ) : (
          <span className="text-[12px] font-semibold text-warning">FI &gt; 50 yr out</span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] tabular-nums text-ink-faint">{sub}</div>
    </div>
  );
}

export default function AllocationPanel({ base }: { base: AllocationInput }) {
  const [surplus, setSurplus] = useState(Math.round(base.surplusPerMonth));
  const [lump, setLump] = useState(0);

  const result = useMemo(
    () => computeAllocation({ ...base, surplusPerMonth: surplus, lumpSum: lump, now: new Date(base.now) }),
    [base, surplus, lump],
  );

  // Sequential rungs only — the mortgage-vs-invest fork is its own head-to-head below.
  const fundedRungs = result.rungs.filter(
    (r) => (r.key === "debt" || r.key === "reserve" || r.key === "revolving" || r.key === "emergency") && r.amount > 0,
  );
  const hasPool = result.total > 0;
  const fork = result.mortgageVsInvest;
  const payWins = fork.choice === "mortgage";
  const verdict =
    fork.monthsSooner == null
      ? null
      : fork.monthsSooner > 0
        ? `Paying it down reaches FI ${durationLabel(fork.monthsSooner)} sooner`
        : fork.monthsSooner < 0
          ? `Investing reaches FI ${durationLabel(-fork.monthsSooner)} sooner`
          : "Same FI date either way";

  return (
    <div className="mt-3.5 rounded-card bg-surface p-5 shadow-card">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-faint">Where should it go?</h3>
        {hasPool && <span className="h-1.5 w-1.5 rounded-full bg-positive" />}
      </div>

      <div className="mt-2">
        <Lever name="Spare / cycle" sub="from your Position — editable" value={surplus} onChange={setSurplus} step={50} min={0} max={20000} prefix="$" />
        <Lever name="Lump sum now" sub="one-off, applied today" value={lump} onChange={setLump} step={1000} min={0} max={500000} prefix="$" />
      </div>

      {hasPool ? (
        <>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-muted">{result.recommendation}</p>
          {fundedRungs.length > 0 && (
            <div className="mt-3 flex flex-col gap-0">
              {fundedRungs.map((r, i) => (
                <RungRow key={r.key} rung={r} last={i === fundedRungs.length - 1} />
              ))}
              <div className="py-0.5 text-center text-[13px] leading-none text-ink-faint">▾</div>
            </div>
          )}

          {/* Final fork as a head-to-head: if invest → X | if mortgage → Y. */}
          <div className="mt-1">
            <div className="mb-1.5 flex items-center gap-1.5">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">The rest — mortgage or investments?</h4>
              <InfoSheet title="Mortgage or investments?" answers="How this picks between paying down and investing your spare">
                <p className="mb-3 text-sm leading-snug text-ink-muted">
                  Your spare is routed to whichever reaches <span className="text-ink">financial independence</span> sooner.
                  Both paths spend the same money each month — paying the mortgage down clears it earlier, then the freed{" "}
                  {money(fork.freedPayment)}/mo repayment redirects into investing (in both paths; only the timing differs).
                </p>
                <p className="mb-3 text-sm leading-snug text-ink-muted">
                  It assumes the spare is money you&apos;d <span className="text-ink">otherwise invest</span>, and that you&apos;d{" "}
                  <span className="text-ink">reinvest the freed repayment</span> after payoff. If you&apos;d actually spend
                  either, paying down looks relatively better.
                </p>
                <p className="text-sm leading-snug text-ink-faint">
                  Today&apos;s dollars. The FI number is held constant — clearing the mortgage also lowers it (interest leaves
                  your spending), so paying down is, if anything, a touch better than shown.
                </p>
              </InfoSheet>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <ForkCard
                title="Pay the mortgage" routed={fork.routed} chosen={payWins}
                fiDate={fork.payMortgage.fiDate} fiAge={fork.payMortgage.fiAge} fiReached={fork.payMortgage.fiReached}
                sub={`mortgage-free ${fork.payMortgage.mortgageFreeDate ?? "—"}`}
              />
              <ForkCard
                title="Invest it" routed={fork.routed} chosen={!payWins}
                fiDate={fork.invest.fiDate} fiAge={fork.invest.fiAge} fiReached={fork.invest.fiReached}
                sub={`~${(fork.nominalReturn * 100).toFixed(1)}% nominal, with risk`}
              />
            </div>
            {verdict && <p className="mt-2.5 text-center text-[14px] font-bold text-positive">{verdict}</p>}
            {payWins && fork.payMortgage.interestSaved != null && fork.payMortgage.interestSaved > 0 && (
              <p className="mt-1 text-center text-[11px] tabular-nums text-ink-muted">
                + {money(fork.payMortgage.interestSaved)} mortgage interest saved over the loan
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="mt-4 border-t border-hairline pt-3 text-[12px] text-ink-faint">No spare to allocate this cycle — add a lump sum to model a one-off.</p>
      )}

      <p className="mt-3 text-[11px] leading-snug text-ink-faint">
        Cascade shows this cycle&apos;s split; the FI comparison assumes your full spare lands at the final choice once the backlog (card, loan, reserves) clears. Levers reset on reload — nothing is saved.
      </p>
    </div>
  );
}
