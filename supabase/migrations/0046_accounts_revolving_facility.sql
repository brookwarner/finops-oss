-- 0046_accounts_revolving_facility.sql
-- Flags an account as a revolving/offset credit facility whose undrawn available
-- balance counts as runway in the cashflow forecast. Replaces the hardcoded
-- REVOLVING_ACCOUNT_ID. Multiple allowed per household (no unique index).
alter table accounts
  add column if not exists is_revolving_facility boolean not null default false;
