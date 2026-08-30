// src/components/cashflow-hero.tsx
import Link from "next/link";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { type CashflowResult } from "@/lib/cashflow/engine";

// Compact /budgets hero for the unified cashflow game-plan. Shows the actual-pace
// weeks (or "covered") + the next-bills verdict, and links into /forecast for the
// full what-if. Server-rendered (static), calm card styling.

const money0 = (n: number) => formatCurrency(n, { decimals: 0, signDisplay: "never" });

export function CashflowHero({ result }: { result: CashflowResult }) {
  const actual = result.lines.find((l) => l.key === "actual");
  const covered = actual != null && actual.cashZeroDate == null;
  const nb = result.nextBills;
  const margin = result.verdict.margin;

  return (
    <Link
      href="/forecast"
      className="mb-3 block rounded-card bg-surface p-5 shadow-card active:opacity-80"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Cashflow game-plan
      </span>

      {covered ? (
        <p className="mt-1.5 text-[20px] font-bold leading-tight text-positive">
          ✓ Income covers your burn
        </p>
      ) : (
        <p className="mt-1.5 text-[18px] font-bold leading-tight tabular-nums text-ink">
          Cash {actual?.cashZeroDate ? formatDateShort(actual.cashZeroDate) : "—"}
          <span className="text-ink-faint"> · </span>
          <span className="text-warning">
            On credit {actual?.creditZeroDate ? formatDateShort(actual.creditZeroDate) : "—"}
          </span>
        </p>
      )}

      {nb && (
        <p className={`mt-1 text-[12px] tabular-nums ${result.verdict.makesIt ? "text-positive" : "text-negative"}`}>
          {result.verdict.makesIt
            ? `Clears your ${formatDateShort(nb.date)} bills with ${money0(margin)} to spare`
            : `${money0(Math.abs(margin))} short of your ${formatDateShort(nb.date)} bills`}
        </p>
      )}
      {!covered && !nb && actual?.cashZeroDate && (
        <p className="mt-1 text-[12px] text-ink-faint tabular-nums">cash dry ~{formatDateShort(actual.cashZeroDate)}</p>
      )}

      <span className="mt-3 inline-block text-[12px] font-medium text-accent">Open game plan →</span>
    </Link>
  );
}
