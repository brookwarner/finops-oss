-- 0048_accounts_emergency_fund.sql
-- Designates one liquid account as the household's emergency fund (cash buffer),
-- and stores its target size in MONTHS of essential spend. Mirrors the
-- is_reserve_buffer pattern (0037): exactly one per household, and the designated
-- account is carved out of FI assets so the same dollars aren't counted as both a
-- safety cushion and FI progress.
alter table accounts
  add column if not exists is_emergency_fund boolean not null default false,
  add column if not exists emergency_fund_target_months numeric not null default 3;

-- At most one emergency fund per household.
create unique index if not exists accounts_one_emergency_fund_per_household
  on accounts (household_id)
  where is_emergency_fund;
