// src/lib/forecast/walk.ts
// Pure balance-walk shared by the forecast (single line) and cashflow (four
// scenario lines) engines. No Supabase, no server imports — client-safe.

import type { ForecastEvent } from "./events";

const DAY_MS = 86_400_000;
function iso(d: Date): string { return d.toISOString().slice(0, 10); }

export interface SeriesPoint { date: string; balance: number }

/**
 * Walk a balance series forward day-by-day from `now`, applying each day's net
 * event delta. series[0] is the end-of-day-0 balance: it equals `start` only
 * when no event lands on now's date. Balances are rounded to 2dp.
 */
export function walkSeries(now: Date, horizonDays: number, start: number, events: ForecastEvent[]): SeriesPoint[] {
  const byDate = new Map<string, number>();
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.delta);
  const out: SeriesPoint[] = [];
  let bal = start;
  for (let i = 0; i <= horizonDays; i++) {
    const d = iso(new Date(now.getTime() + i * DAY_MS));
    bal += byDate.get(d) ?? 0;
    out.push({ date: d, balance: Math.round(bal * 100) / 100 });
  }
  return out;
}
