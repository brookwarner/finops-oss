-- 0044_amortising_liabilities.sql
-- Terms for a manual liability that auto-reduces as real repayments post.
-- 1:1 with a manual_* accounts row (akahu_account_id is unique on accounts).
create table amortising_liabilities (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references households(id) on delete cascade,
  akahu_account_id       text not null unique
                           references accounts(akahu_account_id) on delete cascade,
  anchor_balance         numeric not null,
  anchor_date            date not null,
  annual_rate            numeric not null default 0,
  repayment_category_id  uuid not null references categories(id) on delete restrict,
  created_at             timestamptz not null default now()
);

create index amortising_liabilities_household_idx on amortising_liabilities(household_id);

alter table amortising_liabilities enable row level security;

-- Members may read their household's loan terms (PWA). Writes are service-role.
create policy "members can read amortising liabilities in their household"
  on amortising_liabilities for select
  using (exists (
    select 1 from household_members hm
    where hm.household_id = amortising_liabilities.household_id
      and hm.user_id = auth.uid()
  ));
