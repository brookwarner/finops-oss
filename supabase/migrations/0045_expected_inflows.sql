-- 0045_expected_inflows.sql
-- Per-inflow terms for a manual "receivable" asset (money expected to land once:
-- a tax refund, bonus, late invoice, bond refund, receivership claim). 1:1 with a
-- manual_* accounts row; the inflow AMOUNT is the account's balance_current.
create table expected_inflows (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references households(id) on delete cascade,
  akahu_account_id  text not null unique
                      references accounts(akahu_account_id) on delete cascade,
  likelihood        text not null default 'likely'
                      check (likelihood in ('likely','uncertain')),
  expected_date     date,
  pre_tax           boolean not null default false,
  tax_rate          numeric not null default 0,
  created_at        timestamptz not null default now()
);

create index expected_inflows_household_idx on expected_inflows(household_id);

alter table expected_inflows enable row level security;

create policy "members can read expected inflows in their household"
  on expected_inflows for select
  using (exists (
    select 1 from household_members hm
    where hm.household_id = expected_inflows.household_id
      and hm.user_id = auth.uid()
  ));
