export const CYCLE_START_DAY = 20;
export const ROLLING_PERIODS = 3;
// Reserves (sinking funds) start accruing from this fixed date with an opening
// balance of $0. A clean forward-looking reset rather than back-accruing years of
// pre-app history (which produced nonsensical balances). Spend before this date is
// ignored. The balance can go negative — an overdrawn fund shows its true position
// (we deliberately don't seed a notional opening balance, as no real money is set
// aside; a negative just says "spent ahead of what's accrued so far").
export const RESERVE_ACCRUAL_START = new Date(Date.UTC(2026, 0, 1));

export interface Period { start: Date; end: Date; }

// All cycle-boundary math uses UTC throughout — consistent with forecast/mortgage
// which use Date.UTC / getUTC* exclusively. This ensures identical results across
// Vercel (always UTC), local dev (any TZ), and browser (user TZ). Never use local
// date components (getDate/getFullYear/getMonth) here; UTC is the single authority.
export function defaultPeriod(now: Date): Period {
  const day = now.getUTCDate();
  const offset = day >= CYCLE_START_DAY ? 0 : -1;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, CYCLE_START_DAY));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, CYCLE_START_DAY));
  return { start, end };
}
// Serialise using UTC date components so the calendar day matches the UTC
// midnight boundaries produced by defaultPeriod. Using local getters would
// shift the date back one day in any positive UTC offset (e.g. NZST +12).
export function toISODate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
export function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? fallback : d;
}
export function daysBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}
export function periodProgress(start: Date, end: Date, now: Date) {
  const periodLength = Math.max(1, daysBetween(start, end));
  const clampedNow = now < end ? now : end;
  const dayOfPeriod = Math.min(periodLength, daysBetween(start, clampedNow) + 1);
  const daysLeft = Math.max(0, periodLength - dayOfPeriod);
  return { periodLength, dayOfPeriod, daysLeft };
}
// Whole calendar months between two dates (b - a). Negative if b precedes a.
// Used for sinking-fund accrual: months elapsed since a reserve's inception.
export function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}
export function rollingWindowStart(start: Date, periods = ROLLING_PERIODS): Date {
  return new Date(start.getFullYear(), start.getMonth() - periods, start.getDate());
}
export function priorCycleStart(start: Date): Date {
  return new Date(start.getFullYear(), start.getMonth() - 1, start.getDate());
}
