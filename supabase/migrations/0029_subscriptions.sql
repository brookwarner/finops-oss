-- F2: subscription & recurring-charge radar.
-- One row per detected recurring merchant, upserted nightly by
-- src/lib/subscriptions/sync.ts (same pattern as holdings/net_worth_snapshots).
-- amount* are canonical NATIVE amounts as ABS (outflows stored negative
-- elsewhere; here we keep positive magnitudes). last_duplicate_window is the
-- newest cadence window a double-charge landed in; the evaluate-alerts cron
-- fires subscription_duplicate when it's newer than the latest such alert.

create table subscriptions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  merchant_key  text not null,
  display_name  text not null,
  category_id   uuid references categories(id) on delete set null,
  cadence       text not null check (cadence in
                  ('weekly','fortnightly','monthly','quarterly','annual')),
  amount        numeric(14,2) not null,
  amount_min    numeric(14,2) not null,
  amount_max    numeric(14,2) not null,
  occurrences   integer not null,
  first_seen    date not null,
  last_seen     date not null,
  next_expected date not null,
  status        text not null check (status in ('active','lapsed')),
  last_duplicate_window date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, merchant_key)
);

create index subscriptions_household_idx on subscriptions(household_id);

alter table subscriptions enable row level security;

create policy "members can read subscriptions in their household"
  on subscriptions for select
  using (exists (
    select 1 from household_members hm
    where hm.household_id = subscriptions.household_id and hm.user_id = auth.uid()
  ));

-- Extend alerts for the two new subscription alert types + a stable reference.
alter table alerts drop constraint alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in
  ('cap_breach','cap_warning','cap_ok','reserve_withdrawal','flex_digest',
   'subscription_new','subscription_duplicate'));

alter table alerts add column subscription_id uuid
  references subscriptions(id) on delete set null;

create index alerts_subscription_idx on alerts (household_id, subscription_id, type)
  where subscription_id is not null;
