-- Source-owned expectations, deliberately separate from bank balances/assets.
create table public.expected_income_snapshots (
  household_id uuid not null references public.households(id) on delete cascade,
  source text not null check (source = 'brookos'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (household_id, source)
);
alter table public.expected_income_snapshots enable row level security;
revoke all on public.expected_income_snapshots from anon, authenticated;
grant select on public.expected_income_snapshots to authenticated;
grant all on public.expected_income_snapshots to service_role;
create policy "members read expected income" on public.expected_income_snapshots
for select to authenticated using (exists (
  select 1 from public.household_members hm
  where hm.household_id = expected_income_snapshots.household_id
    and hm.user_id = (select auth.uid())
));
-- Writes use the existing PAT-authenticated service client, with household
-- identity supplied by authentication and enforced by scopedDb.
