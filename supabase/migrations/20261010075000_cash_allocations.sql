-- Validate JSON money at the database boundary as well as the shared API.
create function public.valid_cash_allocation_pots(value jsonb) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(value) is distinct from 'array' then false else
    not exists (select 1 from jsonb_array_elements(value) as p where
      jsonb_typeof(p) is distinct from 'object'
      or jsonb_typeof(p->'label') is distinct from 'string'
      or length(trim(p->>'label')) not between 1 and 80
      or not (case when jsonb_typeof(p->'amount') = 'number' then
        (p->>'amount')::numeric between 0 and 999999999
        and (p->>'amount')::numeric = round((p->>'amount')::numeric, 2)
        else false end)
      or p - 'label' - 'amount' <> '{}'::jsonb)
  end
$$;
revoke all on function public.valid_cash_allocation_pots(jsonb) from public;
grant execute on function public.valid_cash_allocation_pots(jsonb) to authenticated, service_role;

-- One atomic plan per account. Composite FK prevents cross-household references.
alter table public.accounts add constraint accounts_household_id_id_unique unique (household_id, id);
create table public.cash_allocations (
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null,
  business_cash boolean not null default false,
  whole_account_label text check (length(trim(whole_account_label)) between 1 and 80),
  pots jsonb not null default '[]'::jsonb,
  revision integer not null default 1 check (revision > 0),
  primary key (household_id, account_id),
  foreign key (household_id, account_id) references public.accounts(household_id, id) on delete cascade,
  check (public.valid_cash_allocation_pots(pots) and jsonb_array_length(pots) <= 30),
  check (whole_account_label is null or pots = '[]'::jsonb)
);
alter table public.cash_allocations enable row level security;
revoke all on public.cash_allocations from anon, authenticated;
grant select, insert, update, delete on public.cash_allocations to authenticated;
grant all on public.cash_allocations to service_role;
create policy "members read cash allocations" on public.cash_allocations for select to authenticated
using (household_id in (select household_id from public.household_members where user_id = (select auth.uid())));
create policy "members insert cash allocations" on public.cash_allocations for insert to authenticated
with check (household_id in (select household_id from public.household_members where user_id = (select auth.uid())));
create policy "members update cash allocations" on public.cash_allocations for update to authenticated
using (household_id in (select household_id from public.household_members where user_id = (select auth.uid())))
with check (household_id in (select household_id from public.household_members where user_id = (select auth.uid())));
create policy "members delete cash allocations" on public.cash_allocations for delete to authenticated
using (household_id in (select household_id from public.household_members where user_id = (select auth.uid())));
