-- Re-key budget_periods from ambiguous calendar `month` to explicit 20th->20th
-- cycle boundaries, and enrich so a closed cycle renders without re-scanning
-- transactions. Table is empty (never populated), so a destructive alter is safe.

alter table budget_periods drop constraint if exists budget_periods_budget_id_month_key;
drop index if exists budget_periods_household_month_idx;

alter table budget_periods
  drop column if exists month,
  add column period_start date not null,
  add column period_end   date not null,
  add column reimbursed      numeric(14,2) not null default 0,
  add column effective_spend numeric(14,2) not null default 0,
  add column pct              numeric(6,2)  not null default 0,
  add column status text not null default 'ok' check (status in ('ok','warning','over')),
  add column kind   text not null check (kind in ('monthly_cap','reserve','ap_amortised')),
  add column reserve_balance numeric(14,2);

alter table budget_periods
  add constraint budget_periods_budget_id_period_start_key unique (budget_id, period_start);

create index budget_periods_household_period_idx
  on budget_periods (household_id, period_start);
