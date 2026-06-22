import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { listIncomeSources } from "@/lib/income/sources";
import { listSpendSources } from "@/lib/spend/sources";
import { ChevronRight } from "@/components/icons";
import { IncomeTypeEditor } from "./income-type-editor";
import { SpendClassEditor } from "./spend-class-editor";

export const dynamic = "force-dynamic";

// Classification hub: income sources + spending categories on one screen.
// Income classification tells the forecast what to project forward (salary/
// recurring) vs leave out (irregular/one-off), and drives the runway when no
// salary is landing. Spend classification (essential vs discretionary) drives
// the cashflow game-plan's bare-essentials floor and discretionary-cut lever.
export default async function ClassificationSettingsPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const [incomeSources, spendSources] = await Promise.all([
    listIncomeSources(supabase, householdId),
    listSpendSources(supabase, householdId),
  ]);

  return (
    <section className="pb-12">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-faint">
        <Link href="/settings" className="hover:text-ink-muted">
          Settings
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span>Classification</span>
      </div>
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Classification</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Tell the app how to treat your income and spending. These two
        classifications drive the forecast, the cash runway, and the cashflow
        game-plan.
      </p>

      {/* Income sources */}
      <h2 className="mb-1 text-sm font-semibold text-ink">Income sources</h2>
      <p className="mb-3 text-[13px] text-ink-muted">
        Tell the app which income is a salary and which isn&apos;t. Salary and
        recurring income are projected forward in the forecast; irregular and
        one-off income aren&apos;t assumed to repeat. When no salary is landing,
        your budgets page leads with your cash runway.
      </p>
      {incomeSources.length === 0 ? (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted shadow-card">
          No income categories yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {incomeSources.map((s) => (
            <li key={s.id} className="rounded-card bg-surface p-4 shadow-card">
              <div className="text-sm font-semibold text-ink">{s.name}</div>
              <IncomeTypeEditor categoryId={s.id} incomeType={s.incomeType} />
            </li>
          ))}
        </ul>
      )}

      {/* Spending */}
      <h2 className="mb-1 mt-8 text-sm font-semibold text-ink">Spending</h2>
      <p className="mb-3 text-[13px] text-ink-muted">
        Mark each spending category as essential or discretionary. Essentials are
        unavoidable costs that form your bare-minimum floor; discretionary spending
        is what a tight scenario can pause. Anything you don&apos;t classify is
        treated as essential.
      </p>
      {spendSources.length === 0 ? (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted shadow-card">
          No spending categories yet.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {spendSources.map((s) => (
            <li key={s.id} className="rounded-card bg-surface p-4 shadow-card">
              <div className="text-sm font-semibold text-ink">{s.name}</div>
              {s.group && (
                <div className="text-[11px] text-ink-faint">{s.group}</div>
              )}
              <SpendClassEditor categoryId={s.id} spendClass={s.spendClass} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
