-- M5 data layer: per-fund holdings (current state) + daily net-worth snapshots.
-- ----------------------------------------------------------------------------
-- `holdings`: one row per (account, fund), upserted nightly from Akahu's
-- account.meta.portfolio[]. Current-state only (no per-fund history). `value`,
-- `returns`, `cost_basis` are in the fund's NATIVE currency (see `currency`);
-- do NOT sum raw values across funds — the authoritative NZD per-account total
-- is accounts.balance_current. cost_basis = value - returns.
--
-- `net_worth_snapshots`: one row per (household, day). Totals plus a per-account
-- breakdown (signed NZD) so the future trend chart can split into
-- investments/property/cash without per-fund rows. Upserted; last write wins.

create table holdings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  fund_id text not null,
  symbol text,
  name text not null,
  logo text,
  currency text not null,
  shares numeric,
  value numeric(18,4),
  returns numeric(18,4),
  cost_basis numeric(18,4),
  updated_at timestamptz not null default now(),
  unique (account_id, fund_id)
);

create index holdings_household_id_idx on holdings(household_id);
create index holdings_account_id_idx on holdings(account_id);

create table net_worth_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  snapshot_date date not null,
  assets numeric(14,2) not null,
  liabilities numeric(14,2) not null,
  net numeric(14,2) not null,
  breakdown jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (household_id, snapshot_date)
);

create index net_worth_snapshots_household_date_idx
  on net_worth_snapshots(household_id, snapshot_date);
