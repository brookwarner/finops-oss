-- Budgets: one row per budgeted category. The category's own `kind` determines
-- the budgeting style (monthly_cap | reserve | ap_amortised). We keep it
-- on the budget too so reports don't need to join categories just to know how
-- to evaluate. monthly_target is the per-month $ amount; linked_account_id is
-- used by ap_amortised lines (buffer tracking) and is null for cap/sink.
create table budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  kind text not null check (kind in ('monthly_cap','reserve','ap_amortised')),
  monthly_target numeric(14,2) not null,
  linked_account_id uuid references accounts(id) on delete set null,
  reserve_balance numeric(14,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (household_id, category_id)
);

create index budgets_household_id_idx on budgets(household_id);
create index budgets_category_id_idx on budgets(category_id);

-- Budget periods: monthly snapshots. `month` is the first day of the period
-- (e.g. 2026-05-01). spent is signed in the user's perspective (positive =
-- outflow). carryover is for sinking funds.
create table budget_periods (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references budgets(id) on delete cascade,
  household_id uuid not null references households(id) on delete cascade,
  month date not null,
  target numeric(14,2) not null,
  spent numeric(14,2) not null default 0,
  carryover numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique (budget_id, month)
);

create index budget_periods_household_month_idx
  on budget_periods(household_id, month);

alter table budgets enable row level security;
alter table budget_periods enable row level security;

create policy "members can read budgets in their household"
  on budgets for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = budgets.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can manage budgets in their household"
  on budgets for all
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = budgets.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can read budget_periods in their household"
  on budget_periods for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = budget_periods.household_id and hm.user_id = auth.uid()
    )
  );
