import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { scopedDb } from "@/lib/supabase/scoped";
import { presentSubscriptions, type SubRow } from "@/lib/subscriptions/present";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

const CADENCE_ORDER = ["monthly", "fortnightly", "weekly", "quarterly", "annual"] as const;
type CadenceOrder = (typeof CADENCE_ORDER)[number];

const nzd = (n: number) => formatCurrency(n, { decimals: 2 });

export default async function SubscriptionsPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();

  const { data } = await scopedDb(supabase, householdId).subscriptions
    .select(
      "display_name, cadence, amount, amount_min, amount_max, next_expected, last_seen, status, category_id",
    );

  const { subscriptions, totals } = presentSubscriptions((data ?? []) as SubRow[]);
  const active = subscriptions.filter((s) => s.status === "active");
  const lapsed = subscriptions.filter((s) => s.status === "lapsed");

  return (
    <section className="pb-4">
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Subscriptions</h1>
      <p className="mb-5 text-[13px] tabular-nums text-ink-muted">
        {nzd(totals.monthly)}/mo &middot; {nzd(totals.annual)}/yr &middot; {totals.count} active
      </p>

      {active.length === 0 ? (
        <p className="text-sm text-ink-faint">No recurring charges detected yet.</p>
      ) : (
        <ul className="divide-y divide-hairline rounded-card border border-hairline bg-surface shadow-card">
          {[...active]
            .sort(
              (a, b) =>
                CADENCE_ORDER.indexOf(a.cadence as CadenceOrder) -
                CADENCE_ORDER.indexOf(b.cadence as CadenceOrder),
            )
            .map((s) => (
              <li
                key={s.displayName + s.nextExpected}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-medium text-ink">{s.displayName}</div>
                  <div className="mt-0.5 text-[11px] text-ink-faint">
                    {s.cadence} &middot; next {s.nextExpected}
                    {s.priceChanged && (
                      <span className="ml-1 text-warning">
                        &uarr; was {nzd(s.amountMin)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <div className="text-[14px] tabular-nums text-ink">{nzd(s.amount)}</div>
                  <div className="text-[11px] tabular-nums text-ink-faint">{nzd(s.monthly)}/mo</div>
                </div>
              </li>
            ))}
        </ul>
      )}

      {lapsed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer select-none text-xs text-ink-faint">
            {lapsed.length} lapsed
          </summary>
          <ul className="mt-2 divide-y divide-hairline rounded-card border border-hairline bg-surface opacity-60 shadow-card">
            {lapsed.map((s) => (
              <li
                key={s.displayName}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <span className="text-sm text-ink-muted">{s.displayName}</span>
                <span className="text-xs tabular-nums text-ink-faint">last {s.lastSeen}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
