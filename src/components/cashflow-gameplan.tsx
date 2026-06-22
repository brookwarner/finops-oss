// src/components/cashflow-gameplan.tsx
"use client";

import { useMemo, useState } from "react";
import { buildLines, type BuildLinesArgs, type CashflowResult } from "@/lib/cashflow/engine";
import { defaultLandDate } from "@/lib/cashflow/inflows";
import { CashflowChart } from "@/components/cashflow-chart";
import { chartColor } from "@/components/charts";
import { formatCurrency, formatDateShort } from "@/lib/format";

const money0 = (n: number) => formatCurrency(n, { decimals: 0, signDisplay: "never" });

// Serialisable mirror of BuildLinesArgs: everything is JSON-safe except `now`,
// which crosses the server→client boundary as an ISO string and is reconstructed
// into a Date on mount. Toggles are dropped (the island owns them).
export type SerialisableBuildArgs = Omit<BuildLinesArgs, "now" | "toggles"> & { now: string };

// "bill:Mortgage" -> "Mortgage"; income/what-if labels pass through.
const eventName = (label: string) => (label.startsWith("bill:") ? label.slice(5) : label);

// Per-line text-token colour, matching cashflow-chart.tsx's LINE_STYLE roles.
const LINE_TONE: Record<string, string> = {
  actual: "text-positive",
  onBudget: "text-ink-muted",
  bareEssentials: "text-ink-faint",
  custom: "text-warning",
};

// Legend swatch colours — must match the chart's per-line stroke roles.
const LINE_ROLE: Record<string, "positive" | "violet" | "reserve" | "warning"> = {
  actual: "positive", onBudget: "violet", bareEssentials: "reserve", custom: "warning",
};

function Slider({ label, sub, value, onChange, min, max, step, fmt }: {
  label: string; sub: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; fmt: (v: number) => string;
}) {
  return (
    <div className="border-b border-hairline py-3 last:border-b-0">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[13.5px] text-ink">{label}</div>
          <div className="mt-0.5 text-[11px] text-ink-faint">{sub}</div>
        </div>
        <span className="text-[14px] tabular-nums text-ink">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[rgb(var(--positive-bar))]" aria-label={label} />
    </div>
  );
}

export function CashflowGameplan({ result, base }: { result: CashflowResult; base: SerialisableBuildArgs }) {
  const [customCutPct, setCut] = useState(0);
  const [addIncomeWeekly, setIncome] = useState(0);
  const [lumps, setLumps] = useState<Record<string, string>>({});

  // Reconstruct the engine input once (now → Date). The base is otherwise
  // serialisable and stable for the page's lifetime.
  const reconstructed: Omit<BuildLinesArgs, "toggles"> = useMemo(
    () => ({ ...base, now: new Date(base.now) }),
    [base],
  );

  const recomputed = useMemo(
    () => buildLines({ ...reconstructed, toggles: { customCutPct, addIncomeWeekly, lumps } }),
    [reconstructed, customCutPct, addIncomeWeekly, lumps],
  );

  const actual = recomputed.lines.find((l) => l.key === "actual");
  const covered = actual != null && actual.cashZeroDate == null;

  const nb = recomputed.nextBills;
  const margin = recomputed.verdict.margin;

  return (
    <div className="rounded-card bg-surface p-5 shadow-card">
      {/* Adaptive headline */}
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Cashflow game-plan
      </span>
      {covered ? (
        <p className="mt-1.5 text-[22px] font-bold leading-tight text-positive">
          ✓ Income covers your burn
        </p>
      ) : (
        <div className="mt-1.5 flex items-baseline gap-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Cash</div>
            <div className="text-[22px] font-bold leading-none tabular-nums text-ink">
              {actual?.cashZeroDate ? formatDateShort(actual.cashZeroDate) : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">On credit</div>
            <div className="text-[22px] font-bold leading-none tabular-nums text-warning">
              {actual?.creditZeroDate ? formatDateShort(actual.creditZeroDate) : "—"}
            </div>
          </div>
        </div>
      )}
      {nb && (
        <p className={`mt-1 text-[12px] tabular-nums ${recomputed.verdict.makesIt ? "text-positive" : "text-negative"}`}>
          {recomputed.verdict.makesIt
            ? `Clears your ${formatDateShort(nb.date)} bills with ${money0(margin)} to spare`
            : `${money0(Math.abs(margin))} short of your ${formatDateShort(nb.date)} bills`}
        </p>
      )}

      {/* Chart */}
      <div className="mt-4">
        <CashflowChart
          creditHeadroom={recomputed.creditHeadroom}
          lines={recomputed.lines.map((l) => ({ key: l.key, label: l.label, series: l.series, creditZeroDate: l.creditZeroDate }))}
        />
        <p className="mt-2 text-[11px] text-ink-faint">
          Below $0 you&apos;re drawing on ~{formatCurrency(recomputed.creditHeadroom, { decimals: 0 })} of revolving credit — debt, not income.
        </p>
      </div>

      {/* Legend */}
      <ul className="mt-3 space-y-1">
        {recomputed.lines.map((l) => {
          const cash = l.cashZeroDate ? formatDateShort(l.cashZeroDate) : "—";
          const credit = l.creditZeroDate ? formatDateShort(l.creditZeroDate) : "covered";
          return (
            <li key={l.key} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="flex items-center gap-1.5">
                <span style={{ background: chartColor(LINE_ROLE[l.key] ?? "muted") }} className="inline-block h-2.5 w-2.5 rounded-sm" />
                <span className={`font-medium ${LINE_TONE[l.key] ?? "text-ink"}`}>{l.label}</span>
              </span>
              <span className="tabular-nums text-ink-faint">cash {cash} · credit {credit}</span>
            </li>
          );
        })}
      </ul>

      {/* Controls */}
      <div className="mt-4">
        <Slider label="Cut discretionary" sub="% off discretionary spend"
          value={customCutPct} onChange={setCut} min={0} max={80} step={5} fmt={(v) => `${v}%`} />
        <Slider
          label="Add income"
          sub={
            recomputed.context.baselineWeeklyIncome >= 1
              ? `extra, on top of ~${money0(recomputed.context.baselineWeeklyIncome)}/wk projected income`
              : "extra, per week (no recurring income projected — irregular pay isn't assumed to continue)"
          }
          value={addIncomeWeekly} onChange={setIncome} min={0} max={10000} step={50} fmt={(v) => `${money0(v)}/wk`} />
        {result.inflows.map((inflow) => {
          const on = lumps[inflow.id] != null;
          return (
            <div key={inflow.id} className="flex items-center justify-between gap-3 border-t border-hairline py-2">
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setLumps((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) next[inflow.id] = defaultLandDate(inflow, reconstructed.now);
                      else delete next[inflow.id];
                      return next;
                    })
                  }
                />
                <span>
                  {inflow.label}
                  <span className="ml-1.5 text-[11px] text-ink-faint">{inflow.likelihood}</span>
                </span>
                <span className="tabular-nums">· {money0(inflow.amount)} {inflow.taxRate > 0 ? "gross" : "net"}</span>
                {inflow.taxRate > 0 && (
                  <> → {money0(inflow.amount * (1 - inflow.taxRate))} net ({Math.round(inflow.taxRate * 100)}% tax)</>
                )}
              </label>
              {on && (
                <input
                  type="date"
                  value={lumps[inflow.id] ?? ""}
                  onChange={(e) => setLumps((prev) => ({ ...prev, [inflow.id]: e.target.value }))}
                  className="rounded border border-hairline bg-surface px-2 py-1 text-[12px] text-ink"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* What's coming */}
      <WhatsComing events={recomputed.events} />
    </div>
  );
}

const MAX_EVENTS = 25;

function WhatsComing({ events }: { events: CashflowResult["events"] }) {
  // Discrete drivers only — the daily variable burn is run-rated, not a dated
  // line item, so it would flood the agenda. Dated income + committed bills are
  // what a reader can act on.
  const rows = events
    .filter((e) => e.kind !== "variable")
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MAX_EVENTS);
  const truncated = rows.length - shown.length;

  return (
    <section className="mt-4 border-t border-hairline pt-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">What&apos;s coming</h2>
      <ul className="mt-2 divide-y divide-hairline">
        {shown.map((e, i) => (
          <li key={`${e.date}-${i}`} className="flex items-baseline gap-3 py-2">
            <span className="w-20 shrink-0 text-[13px] tabular-nums text-ink-muted">{formatDateShort(e.date)}</span>
            <span className="flex-1 truncate text-[13px] text-ink">{eventName(e.label)}</span>
            <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${e.delta >= 0 ? "text-positive" : "text-ink"}`}>
              {formatCurrency(e.delta, { decimals: 0, signDisplay: "always" })}
            </span>
          </li>
        ))}
      </ul>
      {truncated > 0 && (
        <p className="mt-2.5 text-[11px] text-ink-faint">+{truncated} more further out · plus everyday spend</p>
      )}
    </section>
  );
}
