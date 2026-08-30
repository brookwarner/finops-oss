-- Accounts: one row per linked Akahu account.
create table accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  akahu_account_id text not null unique,
  akahu_user_token text,  -- encrypted at rest via Supabase; null on shared accounts
  name text not null,
  institution text not null,
  type text not null,  -- 'checking','savings','credit_card','mortgage','kiwisaver','loan','investment','other'
  currency text not null default 'NZD',
  balance_current numeric(14,2),
  balance_available numeric(14,2),
  refreshed_at timestamptz,
  created_at timestamptz not null default now()
);

create index accounts_household_id_idx on accounts(household_id);

-- Categories: hierarchical taxonomy with budget kind + grouping.
create table categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  name text not null,
  parent_id uuid references categories(id) on delete set null,
  "group" text,  -- 'Food','Discretionary','Kids','Wellbeing','Transit','Maintenance','Utilities','Mortgage','Investments','Savings','Business', etc.
  kind text not null check (kind in ('monthly_cap','sinking_fund','ap_amortised','income','transfer','business_subsidy','system')),
  context text not null default 'personal' check (context in ('personal','business','bush_base')),
  color text,
  icon text,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

create index categories_household_id_idx on categories(household_id);
create index categories_parent_id_idx on categories(parent_id);

-- Seed an Uncategorised category per household.
create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into categories (household_id, name, kind, "group", context)
  values (new.id, 'Uncategorised', 'system', 'System', 'personal');
  return new;
end;
$$;

create trigger on_household_created
  after insert on households
  for each row execute function public.seed_default_categories();

-- Transactions: signed amounts (negative = outflow/debit, positive = inflow/credit).
-- Akahu posts debits as negative on every account type (purchases, loan interest, etc.);
-- spend is computed as -amount so positive outflow = negative DB value.
create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  akahu_transaction_id text not null unique,
  occurred_at timestamptz not null,
  amount numeric(14,2) not null,  -- negative = outflow (debit), positive = inflow (credit)
  merchant text,
  description text,
  category_id uuid references categories(id) on delete set null,
  is_manual_category boolean not null default false,
  akahu_category text,  -- bank-side hint
  raw jsonb not null,
  created_at timestamptz not null default now()
);

create index transactions_household_id_occurred_at_idx
  on transactions(household_id, occurred_at desc);
create index transactions_account_id_idx on transactions(account_id);
create index transactions_category_id_idx on transactions(category_id);

-- RLS
alter table accounts enable row level security;
alter table categories enable row level security;
alter table transactions enable row level security;

create policy "members can read accounts in their household"
  on accounts for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = accounts.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can read categories in their household"
  on categories for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = categories.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can update categories in their household"
  on categories for update
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = categories.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can read transactions in their household"
  on transactions for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = transactions.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can update transactions in their household"
  on transactions for update
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = transactions.household_id and hm.user_id = auth.uid()
    )
  );
