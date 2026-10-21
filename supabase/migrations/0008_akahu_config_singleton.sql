-- Single-row config table for the Akahu personal-app user token.
-- One user, one token: rotating it = one UPDATE, not N per-account UPDATEs.
-- Locked to id = true so there can only ever be one row.
create table public.akahu_config (
  id boolean primary key default true check (id = true),
  user_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.akahu_config enable row level security;
-- No policies: service-role only.

-- Seed from existing per-account tokens. Single-user-now means there's
-- one distinct value; pick any.
insert into public.akahu_config (id, user_token)
select true, akahu_user_token
from public.accounts
where akahu_user_token is not null
limit 1
on conflict do nothing;
