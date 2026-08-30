-- Households are the RLS anchor. v1 has one household per user; the schema
-- supports many-to-many so Partner can join later without a rewrite.

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_id_idx on household_members(user_id);

-- RLS
alter table households enable row level security;
alter table household_members enable row level security;

create policy "members can read their household"
  on households for select
  using (
    exists (
      select 1 from household_members
      where household_members.household_id = households.id
        and household_members.user_id = auth.uid()
    )
  );

create policy "members can read their own membership rows"
  on household_members for select
  using (user_id = auth.uid());

-- Bootstrap: when a new auth.users row is created, give them a household.
create or replace function public.bootstrap_household_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_household_id uuid;
begin
  insert into households (name) values (coalesce(new.email, 'Household'))
    returning id into new_household_id;
  insert into household_members (household_id, user_id, role)
    values (new_household_id, new.id, 'owner');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.bootstrap_household_for_user();
