"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, ArrowLeftRight, Inbox, TrendingUp, Activity } from "./icons";

type Tab = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
  badge?: boolean;
};

// Ordered as a time telescope by horizon, most-used first: this cycle (Budgets)
// → next ~30 days (Forecast) → months-years wealth/FI (Net worth). Inbox is the
// action queue; Transactions is the raw ledger, demoted to last (debug-ish, least
// glanced). Connect/Subs/Settings live behind the header cog, off the bar.
const TABS: Tab[] = [
  { href: "/budgets", label: "Budgets", Icon: Wallet },
  { href: "/forecast", label: "Forecast", Icon: Activity },
  { href: "/investments", label: "Net worth", Icon: TrendingUp },
  { href: "/inbox", label: "Inbox", Icon: Inbox, badge: true },
  { href: "/transactions", label: "Transactions", Icon: ArrowLeftRight },
];

// Native-style bottom tab bar for the installed PWA. Honours the iOS home-bar
// safe area so the tabs sit above the indicator rather than under it.
export function BottomNav({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();

  return (
    <nav
      className="shrink-0 border-t border-hairline bg-bg/90 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex max-w-3xl items-stretch justify-around px-2">
        {TABS.map(({ href, label, Icon, badge }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch
              aria-current={active ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium tracking-tight whitespace-nowrap transition-colors ${
                active ? "text-accent" : "text-ink-faint hover:text-ink-muted"
              }`}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" />
                {badge && inboxCount > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full bg-warning px-1 text-center text-[9px] font-semibold leading-4 text-white">
                    {inboxCount > 99 ? "99+" : inboxCount}
                  </span>
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
