// Shared display formatters for the web surfaces (PWA pages + components).
//
// Every page and component used to hand-roll its own `${sign}$${n.toLocaleString
// ("en-NZ", …)}` and `.toLocaleDateString(…)`, which drifted into a handful of
// subtly different styles (0dp vs 2dp, with/without a sign, one date formatter
// missing its locale entirely). These are the single source of truth.
//
// The CLI keeps its own copy in cli/lib/format.mjs — it's a separate ESM module
// that can't import from src and is deliberately token-minimal.

const LOCALE = "en-NZ";
// U+2212 MINUS SIGN, not the ASCII hyphen — it aligns optically with digits in
// tabular-nums columns. This matches the sign every hand-rolled formatter used.
const MINUS = "−";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface CurrencyOptions {
  /** Fraction digits, fixed (min = max). Default 2. */
  decimals?: number;
  /** Native currency code; appended (e.g. " USD") when it isn't NZD. */
  currency?: string;
  /**
   * Sign handling:
   *  - `"auto"`   (default) negative gets a minus, positive is bare.
   *  - `"always"` positive gets a leading `+`, negative a minus — for deltas.
   *  - `"never"`  magnitude only; the value is absolute'd.
   */
  signDisplay?: "auto" | "always" | "never";
}

/**
 * Format a NZD-style money value.
 *   formatCurrency(-1240.5)                              -> "−$1,240.50"
 *   formatCurrency(1240, { decimals: 0 })               -> "$1,240"
 *   formatCurrency(50, { signDisplay: "always" })       -> "+$50.00"
 *   formatCurrency(12, { currency: "USD" })             -> "$12.00 USD"
 */
export function formatCurrency(n: number, opts: CurrencyOptions = {}): string {
  const { decimals = 2, currency, signDisplay = "auto" } = opts;
  const body = Math.abs(n).toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign =
    signDisplay === "never" ? "" : n < 0 ? MINUS : signDisplay === "always" ? "+" : "";
  const suffix = currency && currency !== "NZD" ? ` ${currency}` : "";
  return `${sign}$${body}${suffix}`;
}

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Day + short month, e.g. "5 Jun". Compact contexts (chart axes, previews). */
export function formatDateShort(d: DateInput): string {
  return toDate(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

/** Day + short month + year, e.g. "5 Jun 2026". Lists where the year matters. */
export function formatDateFull(d: DateInput): string {
  return toDate(d).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

/** Full local date + time, e.g. for "last used" / "refreshed at" stamps. */
export function formatDateTime(d: DateInput): string {
  return toDate(d).toLocaleString(LOCALE);
}

/** "2054-02" -> "Feb 2054"; null/empty -> "—". */
export function formatMonthYear(ym: string | null): string {
  if (!ym) return "—";
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1] ?? "?"} ${y}`;
}
