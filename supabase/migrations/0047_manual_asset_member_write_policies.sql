-- 0047_manual_asset_member_write_policies.sql
-- The PWA writes manual assets through the user's cookie session (a user-scoped
-- client, subject to RLS) — see resolveIdentity() / /api/assets. Before this the
-- route was Bearer-only (service-role, RLS bypassed), so the child tables of a
-- manual asset only ever got a SELECT policy. Cookie-path inserts/updates into
-- them therefore failed: "new row violates row-level security policy".
--
-- Mirror the member write policies `accounts` already has. Child DELETEs are
-- handled by FK ON DELETE CASCADE (which is not subject to RLS), so they only
-- need INSERT + UPDATE; `accounts` itself needs an explicit DELETE policy for
-- the Remove button.

-- expected_inflows: receivable terms (1:1 with a manual_* account)
create policy "members can insert expected inflows in their household"
  on expected_inflows for insert
  with check (exists (
    select 1 from household_members hm
    where hm.household_id = expected_inflows.household_id
      and hm.user_id = auth.uid()
  ));

create policy "members can update expected inflows in their household"
  on expected_inflows for update
  using (exists (
    select 1 from household_members hm
    where hm.household_id = expected_inflows.household_id
      and hm.user_id = auth.uid()
  ));

-- amortising_liabilities: loan terms (1:1 with a manual_* account)
create policy "members can insert amortising liabilities in their household"
  on amortising_liabilities for insert
  with check (exists (
    select 1 from household_members hm
    where hm.household_id = amortising_liabilities.household_id
      and hm.user_id = auth.uid()
  ));

create policy "members can update amortising liabilities in their household"
  on amortising_liabilities for update
  using (exists (
    select 1 from household_members hm
    where hm.household_id = amortising_liabilities.household_id
      and hm.user_id = auth.uid()
  ));

-- accounts: allow members to delete (the manual-asset Remove button) — the table
-- already has member INSERT/UPDATE/SELECT but no DELETE.
create policy "members can delete accounts in their household"
  on accounts for delete
  using (exists (
    select 1 from household_members hm
    where hm.household_id = accounts.household_id
      and hm.user_id = auth.uid()
  ));
