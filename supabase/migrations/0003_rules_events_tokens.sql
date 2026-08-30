-- Category rules: auto-categorisation. Evaluated in priority order.
create table category_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  match_type text not null check (match_type in ('exact','pattern')),
  match_value text not null,  -- exact merchant string, or regex pattern
  field text not null default 'merchant' check (field in ('merchant','description')),
  priority int not null default 100,  -- lower = checked first
  source text not null default 'manual' check (source in ('manual','llm','bootstrap')),
  created_at timestamptz not null default now()
);

create index category_rules_household_priority_idx
  on category_rules(household_id, priority);

-- Pending events: webhook payloads queued for the drain cron.
create table pending_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,  -- 'akahu_webhook'
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create index pending_events_unprocessed_idx
  on pending_events(received_at) where processed_at is null;

-- Access tokens: hashed PATs for the CLI and MCP.
create table access_tokens (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create index access_tokens_household_id_idx on access_tokens(household_id);

-- RLS — only category_rules and access_tokens need user-facing policies.
-- pending_events is service-role only (cron drains it).
alter table category_rules enable row level security;
alter table access_tokens enable row level security;

create policy "members can manage their rules"
  on category_rules for all
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = category_rules.household_id and hm.user_id = auth.uid()
    )
  );

create policy "users can manage their own tokens"
  on access_tokens for all
  using (user_id = auth.uid());

alter table pending_events enable row level security;
-- no policies: only service-role can touch this table.
