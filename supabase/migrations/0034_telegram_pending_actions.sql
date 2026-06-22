create table telegram_pending_actions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  action        jsonb not null,
  summary       text not null,
  chat_id       text not null,
  message_id    bigint,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);
create index telegram_pending_actions_household_idx on telegram_pending_actions(household_id);
alter table telegram_pending_actions enable row level security;
-- writes are service-role (webhook) only; no member policy (no PWA read path).
