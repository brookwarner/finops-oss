import { requireHouseholdId } from "@/lib/auth/household";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listHouseholdMembers,
  listAllowlistEmails,
  computePendingInvites,
} from "@/lib/household/members";
import { InviteForm, RevokeInviteButton } from "./invite-form";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const householdId = await requireHouseholdId();
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthenticated");
  const { data: me } = await supabase
    .from("household_members")
    .select("role")
    .eq("user_id", user.id)
    .single();
  const isOwner = me?.role === "owner";

  const members = await listHouseholdMembers(householdId);
  const allowlist = isOwner ? await listAllowlistEmails() : [];
  const pending = computePendingInvites(
    allowlist,
    members.map((m) => m.email),
  );

  return (
    <section className="pb-12">
      <h1 className="mb-1 text-[26px] font-bold tracking-tight">Household members</h1>
      <p className="mb-5 text-sm text-ink-muted">
        Who can see this household&apos;s finances.
        {isOwner ? " Invite someone by email below." : ""}
      </p>

      {isOwner && <InviteForm />}

      <ul className="space-y-2.5">
        {members.map((m) => (
          <li key={m.userId} className="rounded-row bg-surface p-4 text-sm shadow-row">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-ink">
                {m.email ?? "(unknown email)"}
                {m.userId === user.id && (
                  <span className="ml-2 text-xs font-normal text-ink-faint">you</span>
                )}
              </div>
              <span className="rounded-control bg-sunken px-2 py-0.5 text-xs text-ink-muted">
                {m.role}
              </span>
            </div>
            <div className="mt-1 text-xs text-ink-faint">
              Joined: {m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : "—"}
            </div>
          </li>
        ))}
      </ul>

      {isOwner && pending.length > 0 && (
        <>
          <h2 className="mt-8 mb-2.5 text-sm font-semibold text-ink-muted">
            Pending invites
          </h2>
          <ul className="space-y-2.5">
            {pending.map((email) => (
              <li
                key={email}
                className="flex items-center justify-between rounded-row bg-surface p-4 text-sm shadow-row"
              >
                <div>
                  <div className="font-medium text-ink">{email}</div>
                  <div className="text-xs text-ink-faint">Waiting for first sign-in</div>
                </div>
                <RevokeInviteButton email={email} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
