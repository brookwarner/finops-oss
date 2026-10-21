-- Allow household members to insert/update accounts rows scoped to their own household.
-- Read-only policy already exists; this adds the write side so the /connect sync
-- (and any other user-driven account writes) succeed under the user's JWT.
create policy "members can insert accounts in their household"
  on public.accounts for insert
  with check (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = accounts.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can update accounts in their household"
  on public.accounts for update
  using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = accounts.household_id and hm.user_id = auth.uid()
    )
  );
