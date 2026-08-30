import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireHouseholdId } from "@/lib/auth/household";
import { listManualAssets } from "@/lib/assets/store";
import { scopedDb } from "@/lib/supabase/scoped";
import { ChevronRight } from "@/components/icons";
import { AssetsManager } from "./assets-manager";

export const dynamic = "force-dynamic";

// Manual assets the bank feeds can't see (home, money owed, private holdings).
// They already count toward net worth; investment/savings types also feed FI.
export default async function AssetsSettingsPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const assets = await listManualAssets({ supabase, householdId });
  const { data: cats } = await scopedDb(supabase, householdId).categories.select("id, name").order("name");
  const categories = (cats ?? []) as { id: string; name: string }[];

  return (
    <section className="pb-12">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-faint">
        <Link href="/settings" className="hover:text-ink-muted">
          Settings
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span>Manual assets</span>
      </div>
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Manual assets</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Assets and liabilities bank feeds can&apos;t see. These already count
        toward net worth. Negative balances are liabilities. Investment and
        savings types also feed your FI number.
      </p>

      <AssetsManager initial={assets} categories={categories} />
    </section>
  );
}
