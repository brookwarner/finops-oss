import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { listIncomeSources } from "@/lib/income/sources";
import { listSpendSources, listSpendGroups, type SpendSource } from "@/lib/spend/sources";
import { orderGroups } from "@/lib/budgets/groups";
import { ChevronRight } from "@/components/icons";
import { IncomeTypeEditor } from "./income-type-editor";
import { SpendClassEditor } from "./spend-class-editor";
import { GroupEditor } from "./group-editor";

export const dynamic = "force-dynamic";

/** Budget kind → the label used on the /budgets list, so the two screens agree. */
const KIND_LABEL: Record<string, string> = {
  monthly_cap: "Monthly cap",
  ap_amortised: "Auto-pay",
  reserve: "Reserve",
};

const UNGROUPED = "No group";

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

  // Section the spend list by group so the category→group mapping is readable at a
  // glance; ungrouped categories sit last, where they're obvious and easy to file.
  const byGroup = new Map<string, SpendSource[]>();
  for (const s of spendSources) {
    const g = s.group ?? UNGROUPED;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(s);
  }
  const groupOptions = listSpendGroups(spendSources);
  const orderedSections = [
    ...orderGroups([...byGroup.keys()].filter((g) => g !== UNGROUPED)),
    ...(byGroup.has(UNGROUPED) ? [UNGROUPED] : []),
  ];

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
        treated as essential. The group is just the heading your budget list is
        sectioned by — change it any time.
      </p>
      {spendSources.length === 0 ? (
        <p className="rounded-card bg-surface p-4 text-sm text-ink-muted shadow-card">
          No spending categories yet.
        </p>
      ) : (
        orderedSections.map((section) => (
          <div key={section} className="mb-6">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {section}
            </h3>
            <ul className="space-y-2.5">
              {byGroup.get(section)!.map((s) => (
                <li key={s.id} className="rounded-card bg-surface p-4 shadow-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-ink">{s.name}</div>
                    <span className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-sunken px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                      {KIND_LABEL[s.kind] ?? s.kind}
                    </span>
                  </div>
                  <SpendClassEditor categoryId={s.id} spendClass={s.spendClass} />
                  <GroupEditor categoryId={s.id} group={s.group} groups={groupOptions} />
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
