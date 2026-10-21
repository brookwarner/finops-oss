-- Fix: a second user (Partner) signed in and saw none of the owner's accounts.
--
-- Root cause: bootstrap_household_for_user() (migration 0001) fires on every
-- new auth.users row and creates a *brand-new* household for that user. So the
-- second member lands in their own empty household instead of the shared one,
-- and requireHouseholdId() / resolveIdentity() return that empty household ->
-- zero accounts, transactions, budgets.
--
-- v1 is a single shared household ("household-ready data model so Partner can
-- join later" — see CLAUDE.md). The multi-household invite UI is still out of
-- scope, so the interim contract is: the FIRST user bootstraps the household
-- and owns it; every subsequent signup JOINS that household as a member.
--
-- This migration does two things:
--   1. Backfill — move any user stranded in an empty solo household into the
--      shared (primary) household, then delete the now-orphaned empty ones.
--   2. Forward fix — rewrite the bootstrap trigger so future signups join the
--      existing household instead of creating their own.

-- 1) Backfill -----------------------------------------------------------------
do $$
declare
  primary_hh uuid;
begin
  -- The primary household is the one that actually owns financial data. Rank by
  -- account count then age so the shared household (the owner's) always wins; the
  -- empty solo households created for later signups never do.
  select h.id into primary_hh
  from households h
  left join accounts a on a.household_id = h.id
  group by h.id, h.created_at
  order by count(a.id) desc, h.created_at asc
  limit 1;

  if primary_hh is null then
    return; -- fresh database, nothing to consolidate
  end if;

  -- Move members of *empty* households (no accounts, no transactions) into the
  -- primary household as 'member'. Households that hold financial data are left
  -- untouched so we never silently merge real data.
  insert into household_members (household_id, user_id, role)
  select primary_hh, hm.user_id, 'member'
  from household_members hm
  join households h on h.id = hm.household_id
  where hm.household_id <> primary_hh
    and not exists (select 1 from accounts a where a.household_id = h.id)
    and not exists (select 1 from transactions t where t.household_id = h.id)
  on conflict (household_id, user_id) do nothing;

  -- Drop the now-orphaned empty households. The household_members rows for them
  -- cascade away; the only other child is the seeded "Uncategorised" category.
  delete from households h
  where h.id <> primary_hh
    and not exists (select 1 from accounts a where a.household_id = h.id)
    and not exists (select 1 from transactions t where t.household_id = h.id);
end $$;

-- 2) Forward fix --------------------------------------------------------------
create or replace function public.bootstrap_household_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_household_id uuid;
  new_household_id uuid;
begin
  -- If a household already exists, the new user joins it as a member. v1 is a
  -- single shared household; the multi-household UI comes later.
  select id into existing_household_id
  from households
  order by created_at asc
  limit 1;

  if existing_household_id is not null then
    insert into household_members (household_id, user_id, role)
      values (existing_household_id, new.id, 'member');
    return new;
  end if;

  -- First user bootstraps the household and owns it.
  insert into households (name) values (coalesce(new.email, 'Household'))
    returning id into new_household_id;
  insert into household_members (household_id, user_id, role)
    values (new_household_id, new.id, 'owner');
  return new;
end;
$$;
