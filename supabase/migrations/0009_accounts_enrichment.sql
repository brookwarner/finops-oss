-- Per the Akahu account model:
--   status: 'ACTIVE' | 'INACTIVE' — INACTIVE means user re-auth needed
--   attributes: text[] e.g. {'TRANSACTIONS','PAYMENT_TO','PAYMENT_FROM'}
--   refreshed: per-aspect timestamps (balance/transactions/meta/party)
-- These let us surface broken connections and skip transaction polling
-- on accounts without the TRANSACTIONS attribute.
alter table public.accounts
  add column akahu_status text,
  add column attributes text[] not null default '{}',
  add column refreshed_balance_at timestamptz,
  add column refreshed_transactions_at timestamptz,
  add column refreshed_meta_at timestamptz,
  add column refreshed_party_at timestamptz;

-- The user token has moved to akahu_config; per-account storage is gone.
alter table public.accounts drop column akahu_user_token;

-- Old single refreshed_at is superseded by the per-aspect timestamps.
alter table public.accounts drop column refreshed_at;
