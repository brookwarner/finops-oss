import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { loadCashAvailability } from "@/lib/cash-allocations/store";
import { CashAvailabilityCard } from "@/components/cash-availability-card";
import { CashAllocationEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function CashAllocationsPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const state = await loadCashAvailability(supabase, householdId);
  return <section className="pb-12">
    <h1 className="mb-1 text-[26px] font-bold tracking-tight">Cash allocations</h1>
    <p className="mb-5 text-sm text-ink-muted">Give your cash a job: income tax, GST, business costs, or a buffer. Set aside part of an account or protect a whole dedicated account.</p>
    <CashAvailabilityCard state={state} />
    <p className="mb-4 text-xs text-ink-faint">Allocations reduce spendable cash in forecasts. They don&apos;t move money or calculate tax. Enter the amounts you want to protect; reduce or remove them when the obligation is paid. Existing reserve and emergency accounts are already protected.</p>
    {state.accounts.length === 0 && <p className="text-sm text-ink-muted">Connect an NZD checking, savings or wallet account to start.</p>}
    <div className="space-y-4">{state.accounts.map((account) => <CashAllocationEditor key={`${account.accountId}:${account.config.revision}`} account={account} />)}</div>
  </section>;
}
