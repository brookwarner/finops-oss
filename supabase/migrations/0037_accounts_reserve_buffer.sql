-- 0037_accounts_reserve_buffer.sql
-- Designates exactly one account as the reserve "buffer" (rainy-day pot).
-- Inflows to this account credit behind reserves; it is carved out of FI assets
-- so the same dollars aren't counted as both reserve cover and FI progress.
alter table accounts
  add column if not exists is_reserve_buffer boolean not null default false;

-- At most one buffer per household.
create unique index if not exists accounts_one_reserve_buffer_per_household
  on accounts (household_id)
  where is_reserve_buffer;
