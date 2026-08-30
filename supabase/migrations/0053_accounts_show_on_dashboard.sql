-- 0053_accounts_show_on_dashboard.sql
-- Per-account visibility for the Balances widget on /budgets. Defaults to true
-- so a fresh household sees every account and trims from there (the widget's
-- edit mode writes this flag). Display-only: nothing in net worth, budgets, or
-- the cashflow engines reads it.
alter table accounts
  add column if not exists show_on_dashboard boolean not null default true;
