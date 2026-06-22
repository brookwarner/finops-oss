import Link from "next/link";
import { Link2, Repeat, Layers, Users, Activity, ChevronRight } from "@/components/icons";
import { SyncNowButton } from "@/components/sync-now-button";

export const dynamic = "force-dynamic";

// Settings hub: home for the occasional / config routes that used to crowd the
// bottom tab bar (Connect, Subscriptions, Access tokens). Reached via the gear
// in the app header.
const LINKS = [
  {
    href: "/settings/members",
    label: "Household members",
    description: "See who's in your household and invite someone.",
    Icon: Users,
  },
  {
    href: "/settings/classification",
    label: "Classification",
    description: "Income (salary vs one-off) and spending (essential vs discretionary).",
    Icon: Activity,
  },
  {
    href: "/settings/assets",
    label: "Manual assets",
    description: "Track assets bank feeds can't see — home, money owed, private holdings.",
    Icon: Layers,
  },
  {
    href: "/connect",
    label: "Connected accounts",
    description: "Link or re-authorise your bank via Akahu.",
    Icon: Link2,
  },
  {
    href: "/subscriptions",
    label: "Subscriptions",
    description: "Recurring charges and duplicate-charge radar.",
    Icon: Repeat,
  },
  {
    href: "/settings/tokens",
    label: "Access tokens",
    description: "Personal access tokens for the MCP connector.",
    Icon: Layers,
  },
];

export default function SettingsPage() {
  return (
    <section className="pb-12">
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Household members, connections, subscriptions, and access tokens.
      </p>

      <div className="mb-2.5">
        <SyncNowButton />
      </div>

      <ul className="space-y-2.5">
        {LINKS.map(({ href, label, description, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3.5 rounded-row bg-surface p-4 shadow-row transition-colors hover:bg-sunken"
            >
              <span className="text-ink-faint">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{label}</span>
                <span className="block text-xs text-ink-muted">{description}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
