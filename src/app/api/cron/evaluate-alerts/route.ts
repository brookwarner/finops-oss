import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireCronAuth } from "@/lib/api/cron-auth";
import { loadHouseholdIds } from "@/lib/accounts/households";
import { computeBudgets } from "@/lib/budgets/compute";
import { computeForecast } from "@/lib/forecast/compute";
import { defaultPeriod, toISODate } from "@/lib/budgets/period";
import {
  capSnapshotsFromRows,
  loadLastStates,
  loadReserveTxns,
  loadAlertedTxnIds,
  insertAlerts,
  loadSubscriptionSignals,
} from "@/lib/alerts/load";
import { runAlertEvaluation } from "@/lib/alerts/run";
import { decideSubscriptionAlerts } from "@/lib/alerts/subscriptions";
import { decideCoverageAlerts } from "@/lib/alerts/coverage";
import { sendTelegram, telegramConfigFromEnv } from "@/lib/alerts/telegram";
import { loadAllocationInput } from "@/lib/allocation/load";
import { computeAllocation } from "@/lib/allocation/compute";
import { computeSweepNudge } from "@/lib/reserves/nudge";
import { decideSweepNudge, formatSweepNudge } from "@/lib/alerts/sweep";

export const maxDuration = 60;

// Reserve-withdrawal lookback. Generous enough to cover a missed daily run.
const RESERVE_WINDOW_DAYS = 3;

export async function GET(request: NextRequest) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const supabase = createSupabaseServiceClient();
    const telegram = telegramConfigFromEnv();
    const now = new Date();
    const period = defaultPeriod(now);
    const periodStart = toISODate(period.start);
    const sinceISO = new Date(now.getTime() - RESERVE_WINDOW_DAYS * 86_400_000).toISOString();

    // Single user today, but iterate households for the multi-user-ready model.
    const { households, error: acctErr } = await loadHouseholdIds(supabase);
    if (acctErr) return NextResponse.json({ error: acctErr.message }, { status: 500 });

    const results: Record<string, unknown> = {};
    for (const householdId of households) {
      try {
        const compute = await computeBudgets({ supabase, householdId, period });
        const snapshots = capSnapshotsFromRows(compute.rows, compute.period.daysLeft);
        const [lastStates, reserveTxns, alertedTxnIds] = await Promise.all([
          loadLastStates(supabase, householdId, periodStart),
          loadReserveTxns(supabase, householdId, sinceISO, compute),
          loadAlertedTxnIds(supabase, householdId),
        ]);

        const summary = await runAlertEvaluation({
          householdId,
          periodStart,
          snapshots,
          lastStates,
          reserveTxns,
          alertedTxnIds,
          insertAlerts: (rows) => insertAlerts(supabase, rows),
          send: (text) => sendTelegram(text, telegram),
        });
        results[householdId] = summary;

        try {
          const signals = await loadSubscriptionSignals(supabase, householdId);
          const subEvents = decideSubscriptionAlerts({ householdId, ...signals });
          if (subEvents.length > 0) {
            const text = subEvents.map((e) => `• ${e.body}`).join("\n");
            const result = await sendTelegram(text, telegram);
            for (const e of subEvents) {
              e.delivered = result.ok;
              e.delivery_error = result.ok ? null : (result.error ?? "send failed");
            }
            await insertAlerts(supabase, subEvents);
          }
        } catch (e) {
          console.error("[evaluate-alerts] subscriptions error", e);
        }

        try {
          if (compute.shadowCommitted.length > 0) {
            // scoped-db-exempt: cron iterates per householdId; query is always filtered by household_id below.
            const { data: priorRows, error: priorErr } = await supabase
              .from("alerts")
              .select("category_id")
              .eq("household_id", householdId)
              .eq("type", "budget_coverage_gap")
              .eq("period_start", periodStart);
            // If the dedup lookup fails, bail rather than fire — an empty set
            // here would re-send every coverage alert and spam Telegram.
            if (priorErr) throw priorErr;
            const alreadyAlertedCatIds = new Set((priorRows ?? []).map((r) => r.category_id as string));
            const covEvents = decideCoverageAlerts({
              householdId, periodStart,
              shadowBills: compute.shadowCommitted,
              alreadyAlertedCatIds,
            });
            if (covEvents.length > 0) {
              const text = covEvents.map((e) => `• ${e.body}`).join("\n");
              const result = await sendTelegram(text, telegram);
              for (const e of covEvents) {
                e.delivered = result.ok;
                e.delivery_error = result.ok ? null : (result.error ?? "send failed");
              }
              await insertAlerts(supabase, covEvents);
            }
          }
        } catch (e) {
          console.error("[evaluate-alerts] coverage error", e);
        }

        // Reserve sweep nudge: once per cycle, if a buffer is designated and a
        // sweep is still outstanding. Deduped on (type, period_start).
        try {
          if (compute.reserveBuffer.accountId) {
            // scoped-db-exempt: cron iterates per householdId; query is always filtered by household_id below.
            const { data: firedRows, error: firedErr } = await supabase
              .from("alerts")
              .select("id")
              .eq("household_id", householdId)
              .eq("type", "reserve_sweep")
              .eq("period_start", periodStart)
              .limit(1);
            // Throw on a dedup-query failure rather than treating it as "not fired" —
            // a silent empty result would re-fire (and re-Telegram) every cron run
            // for the rest of the cycle. Matches the coverage block's handling.
            if (firedErr) throw firedErr;
            const alreadyFired = (firedRows ?? []).length > 0;

            // Already nudged this cycle → skip the allocation work entirely.
            if (!alreadyFired) {
              const allocInput = await loadAllocationInput({ supabase, householdId, budgets: compute });
              const alloc = computeAllocation(allocInput);
              const reserveRungs = alloc.rungs.filter((r) => r.key === "reserve");
              // Forward-cashflow trough so we only nudge a sweep that survives the
              // next bill cluster. If the forecast can't be built, fall back to the
              // plan-only nudge rather than skip. The cash gate also self-defers the
              // nudge: before payday/bills the trough is low, so remaining is 0 and
              // decideSweepNudge stays quiet until it's genuinely safe to move cash.
              let trough: { balance: number; date: string } | null = null;
              try {
                const forecast = await computeForecast({ supabase, householdId, now });
                trough = forecast.trough;
              } catch (fe) {
                console.error("[evaluate-alerts] sweep forecast error", fe);
              }
              const nudge = computeSweepNudge({
                recommended: reserveRungs.reduce((s, r) => s + r.amount, 0),
                sweptThisCycle: compute.reserveBuffer.sweptThisCycle,
                perReserve: reserveRungs.map((r) => ({ category: r.title, covers: r.amount })),
                trough,
              });

              if (decideSweepNudge(nudge, false)) {
                const line = formatSweepNudge(nudge);
                const send = await sendTelegram(line, telegram);
                await insertAlerts(supabase, [{
                  household_id: householdId,
                  type: "reserve_sweep",
                  category_id: null,
                  period_start: periodStart,
                  state: null,
                  txn_id: null,
                  title: "Sweep your spare to the reserve buffer",
                  body: line,
                  payload: {
                    recommended: nudge.recommended,
                    remaining: nudge.remaining,
                    outstanding: nudge.outstanding,
                    cashCapped: nudge.cashCapped,
                    billsBalance: nudge.billsBalance,
                    billsDate: nudge.billsDate,
                  },
                  delivered: send.ok,
                  delivery_error: send.ok ? null : (send.error ?? "send failed"),
                }]);
              }
            }
          }
        } catch (e) {
          console.error("[evaluate-alerts] sweep nudge error", e);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("[evaluate-alerts] household failed", householdId, message);
        results[householdId] = { error: message };
      }
    }

    return NextResponse.json({ households: households.length, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[evaluate-alerts] cron failed", e);
    await sendTelegram(
      `FinOps cron evaluate-alerts failed: ${message}`,
      telegramConfigFromEnv(),
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
