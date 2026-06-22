import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { computeCashflowBase } from "@/lib/cashflow/compute";
import { buildLines } from "@/lib/cashflow/engine";
import { CashflowGameplan, type SerialisableBuildArgs } from "@/components/cashflow-gameplan";

export const dynamic = "force-dynamic";

export default async function ForecastPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();

  const base = await computeCashflowBase({ supabase, householdId }).catch(() => null);
  if (!base) {
    return (
      <section className="pb-12">
        <h1 className="mb-5 text-[26px] font-bold tracking-tight">Cashflow game-plan</h1>
        <p className="text-sm text-ink-muted">Couldn&apos;t build your cashflow forecast right now.</p>
      </section>
    );
  }

  // First paint from the loaded base; the client island recomputes live as the
  // what-if controls move. Serialise `now` (the only non-JSON field) to an ISO
  // string for the boundary.
  const result = buildLines(base);
  const { now, toggles: _toggles, ...rest } = base;
  const serialisableBase: SerialisableBuildArgs = { ...rest, now: now.toISOString() };

  return (
    <section className="pb-12">
      <h1 className="mb-5 text-[26px] font-bold tracking-tight">Cashflow game-plan</h1>
      <CashflowGameplan result={result} base={serialisableBase} />
    </section>
  );
}
