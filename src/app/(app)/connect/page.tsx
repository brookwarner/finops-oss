import { requireHouseholdId } from "@/lib/auth/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { scopedDb } from "@/lib/supabase/scoped";
import { formatDateTime } from "@/lib/format";
import { RevolvingToggle } from "@/components/revolving-toggle";
import { EmergencyFundToggle } from "@/components/emergency-fund-toggle";

// Account types that can hold a cash emergency fund.
const LIQUID_TYPES = new Set(["savings", "checking", "wallet"]);

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const { data: accounts, error } = await scopedDb(supabase, householdId).accounts
    .select(
      "id, name, institution, type, akahu_status, balance_current, refreshed_balance_at, refreshed_transactions_at, akahu_account_id, is_revolving_facility, is_emergency_fund, emergency_fund_target_months",
    )
    .order("created_at");

  if (error) {
    return <p className="text-sm text-negative">Error: {error.message}</p>;
  }

  return (
    <section className="pb-12">
      <h1 className="mb-5 text-[26px] font-bold tracking-tight">Connected accounts</h1>
      {accounts && accounts.length > 0 ? (
        <ul className="mb-6 space-y-2.5">
          {accounts.map((a: any) => (
            <li key={a.id} className="rounded-row bg-surface p-4 text-sm shadow-row">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-ink">{a.name}</div>
                <span
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    a.akahu_status === "ACTIVE"
                      ? "bg-positive-weak text-positive"
                      : "bg-negative-weak text-negative"
                  }`}
                >
                  {a.akahu_status ?? "unknown"}
                </span>
              </div>
              <div className="text-ink-muted">
                {a.institution} · {a.type}
              </div>
              <div className="mt-1 tabular-nums text-ink">
                Balance: {a.balance_current ?? "—"}
              </div>
              <div className="text-xs text-ink-faint">
                Balance refreshed:{" "}
                {a.refreshed_balance_at ? formatDateTime(a.refreshed_balance_at) : "never"}{" "}
                · Txns:{" "}
                {a.refreshed_transactions_at ? formatDateTime(a.refreshed_transactions_at) : "never"}
              </div>
              <RevolvingToggle akahuAccountId={a.akahu_account_id} initial={a.is_revolving_facility === true} />
              {LIQUID_TYPES.has(a.type) && (
                <EmergencyFundToggle
                  akahuAccountId={a.akahu_account_id}
                  initial={a.is_emergency_fund === true}
                  initialMonths={Number(a.emergency_fund_target_months ?? 3)}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-6 text-sm text-ink-muted">No accounts synced yet.</p>
      )}
      <form action="/api/sync-accounts" method="POST">
        <button
          type="submit"
          className="inline-block cursor-pointer rounded-control bg-accent px-4 py-2 font-medium text-white transition-colors hover:brightness-110"
        >
          Sync accounts from Akahu
        </button>
      </form>
    </section>
  );
}
