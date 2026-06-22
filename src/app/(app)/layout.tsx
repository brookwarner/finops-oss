import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { INBOX_CUTOFF } from "@/lib/constants";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { BottomNav } from "@/components/bottom-nav";
import { Settings } from "@/components/icons";
import { FinopsMark } from "@/components/finops-mark";
import { version } from "../../../package.json";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Inbox count badge: uncategorised, non-manual transactions.
  // scoped-db-exempt: RLS-enforced cookie (ssr) client already restricts rows to
  // the signed-in user's household; this layout has the user but not a resolved
  // householdId and avoids an extra membership round-trip for a count badge.
  const { count: inboxCount } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .is("category_id", null)
    .eq("is_manual_category", false)
    .gte("occurred_at", INBOX_CUTOFF);

  return (
    <div className="mx-auto flex h-dvh max-w-3xl flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-hairline bg-bg/85 px-6 py-3 backdrop-blur">
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink-strong">
          <FinopsMark className="h-5 w-5" />
          FinOps
          <span className="text-[10px] font-medium tabular-nums tracking-normal text-ink-faint">
            v{version}
          </span>
        </span>
        <div className="-my-1 flex items-center gap-1">
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="Settings"
            className="rounded-full p-2 text-ink-faint transition-colors hover:text-ink-muted"
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-5">{children}</main>
      <BottomNav inboxCount={inboxCount ?? 0} />
    </div>
  );
}
