-- Alerts ledger. Records every fired alert event: it backs delivery dedup
-- (state-change semantics for caps, txn-id dedup for reserve withdrawals),
-- history, and a future "show me what changed" feed/MCP query.
--
-- `cap_ok` rows are internal, non-delivered state markers recorded when a cap
-- recovers below its prior band, so a later re-cross can fire again. They are
-- never sent to Telegram.
create table alerts (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references households(id) on delete cascade,
  type           text not null check (type in
                   ('cap_breach','cap_warning','cap_ok','reserve_withdrawal','flex_digest')),
  category_id    uuid references categories(id) on delete set null,
  period_start   date,
  state          text check (state in ('ok','warning','over')),
  txn_id         uuid references transactions(id) on delete set null,
  title          text not null,
  body           text not null,
  payload        jsonb,
  delivered      boolean not null default false,
  delivery_error text,
  fired_at       timestamptz not null default now()
);

-- Dedup lookup: latest cap state per category within a period.
create index alerts_dedup_idx on alerts (household_id, category_id, period_start, type);
-- Recent-feed / MCP query.
create index alerts_recent_idx on alerts (household_id, fired_at desc);
-- Reserve-withdrawal dedup by transaction.
create index alerts_txn_idx on alerts (household_id, txn_id) where txn_id is not null;

alter table alerts enable row level security;

-- Members read their household's alerts. Writes come from the service role
-- (cron), which bypasses RLS, so no insert/update policy is granted to users.
create policy "members can read alerts in their household"
  on alerts for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = alerts.household_id and hm.user_id = auth.uid()
    )
  );
