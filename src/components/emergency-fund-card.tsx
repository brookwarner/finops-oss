import Link from "next/link";
import { formatCurrency } from "@/lib/format";
import type { EmergencyFundState } from "@/lib/buffer/compute";

const nzd = (n: number) => formatCurrency(n, { decimals: 0 });

/** Emergency-fund progress: balance vs an N-months-of-essentials target. Renders
 *  a setup prompt until an account is designated; nothing when there's no
 *  essential-spend signal to size a target from. Server component (read-only). */
export function EmergencyFundCard({ fund }: { fund: EmergencyFundState }) {
  if (fund.target <= 0 && !fund.configured) return null;

  if (!fund.configured) {
    return (
      <div className="rounded-card bg-surface p-5 shadow-card">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Emergency fund</div>
        <p className="mt-1.5 text-[13.5px] leading-snug text-ink-muted">
          Not set up yet. A {fund.targetMonths}-month cushion would be{" "}
          <span className="font-semibold text-ink">{nzd(fund.target)}</span> (≈ {nzd(fund.essentialMonthly)}/mo essentials).
        </p>
        <Link href="/connect" className="mt-2 inline-block text-[12px] font-semibold text-accent">
          Designate a savings account →
        </Link>
      </div>
    );
  }

  const pct = fund.pctFunded != null ? Math.max(0, Math.min(1, fund.pctFunded)) : 0;
  const cover = fund.monthsCovered != null ? fund.monthsCovered.toFixed(1) : "—";
  return (
    <div className="rounded-card bg-surface p-5 shadow-card">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Emergency fund</span>
        <span className="text-[12px] tabular-nums text-ink-faint">{fund.accountName}</span>
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[26px] font-bold leading-none tabular-nums text-ink">{nzd(fund.balance)}</span>
        <span className="text-[13px] tabular-nums text-ink-muted">/ {nzd(fund.target)}</span>
        {fund.funded && <span className="rounded-md bg-positive-weak px-1.5 py-0.5 text-[10px] font-semibold text-positive">funded</span>}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-sunken">
        <div
          className={`h-full rounded-full ${fund.funded ? "bg-positive" : "bg-positive-bar"}`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between text-[12px] tabular-nums">
        <span className="text-ink-muted">
          {cover} of {fund.targetMonths} mo essentials covered
        </span>
        <span className={fund.shortfall > 0 ? "text-warning" : "text-positive"}>
          {fund.shortfall > 0 ? `${nzd(fund.shortfall)} to go` : "fully funded"}
        </span>
      </div>
    </div>
  );
}
