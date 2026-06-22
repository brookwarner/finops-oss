import { NextResponse } from "next/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { revalidateHousehold } from "@/lib/cache/household";
import { runPollTransactions } from "@/lib/cron/poll-transactions";
import { runNightly } from "@/lib/cron/nightly";

export const maxDuration = 300;

/**
 * Manual, user-triggered full Akahu sync. Same work the scheduled crons do,
 * but session-authed (no CRON_SECRET) so the PWA "Sync now" button can fire it.
 *
 * Order matters: poll first to ingest the latest transactions and rule-
 * categorise them, then nightly to refresh balances/holdings/net-worth and run
 * the LLM categorisation fallback over whatever's left uncategorised.
 *
 * The two phases are independent: a failure in one (e.g. the LLM fallback timing
 * out) must not discard the work the other already did, so each is isolated and
 * its error reported rather than thrown. Always 200 — the button reads the
 * per-phase payload to decide what to show.
 */
export async function POST() {
  const householdId = await requireHouseholdId();

  const started = Date.now();

  const poll = await runPollTransactions()
    .then((r) => r.json())
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  const nightly = await runNightly()
    .then((r) => r.json())
    .catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));

  // Ingest just rewrote transactions/balances/holdings — drop the household's
  // cached reads so the next budgets/net-worth view reflects the sync immediately.
  revalidateHousehold(householdId);

  return NextResponse.json({
    ok: !poll?.error,
    durationMs: Date.now() - started,
    poll,
    nightly,
  });
}
