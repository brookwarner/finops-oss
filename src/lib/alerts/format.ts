// Telegram message templates (Markdown). Pure string builders — no IO.

import type { BudgetSnapshot } from "./evaluate";
import type { ReserveEvent } from "./reserve";
import { formatCurrency } from "@/lib/format";

/** Whole-dollar NZD, e.g. 1240 -> "$1,240". Negative magnitudes are absolute'd. */
export function money(n: number): string {
  return formatCurrency(n, { decimals: 0, signDisplay: "never" });
}

export function formatCapBreach(s: BudgetSnapshot): string {
  return `🔴 *${s.category}* over budget — ${money(s.netSpent)} of ${money(s.target)} (${Math.round(s.pct)}%), ${s.daysLeft} days left.`;
}

export function formatCapWarning(s: BudgetSnapshot): string {
  return `🟠 *${s.category}* at ${Math.round(s.pct)}% — ${money(s.netSpent)} of ${money(s.target)}, ${s.daysLeft} days left.`;
}

export function formatReserveWithdrawal(e: ReserveEvent): string {
  const balance = e.reserveBalance === null ? "" : ` Balance: ${money(e.reserveBalance)}.`;
  return `💸 *${e.category}* drawn down ${money(e.amount)}.${balance}`;
}

export interface FlexDigestInput {
  flexAmount: number;
  capsOver: number;
  capsWarning: number;
}

export function formatFlexDigest({ flexAmount, capsOver, capsWarning }: FlexDigestInput): string {
  const head = `📊 *Flex this week:* ${money(flexAmount)}.`;
  if (capsOver === 0 && capsWarning === 0) {
    return `${head} All caps on track.`;
  }
  const parts: string[] = [];
  if (capsOver > 0) parts.push(`${capsOver} over`);
  if (capsWarning > 0) parts.push(`${capsWarning} near limit`);
  return `${head} ${parts.join(", ")}.`;
}

/** Coalesce the morning's alert lines into a single Telegram message. */
export function formatMorningDigest(lines: string[]): string {
  const kept = lines.filter((l) => l && l.trim());
  if (kept.length === 0) return "";
  if (kept.length === 1) return kept[0];
  return `*FinOps — overnight*\n\n${kept.join("\n")}`;
}
