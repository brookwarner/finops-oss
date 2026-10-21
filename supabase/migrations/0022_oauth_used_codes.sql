-- Single-use enforcement for OAuth authorization codes (replay protection).
create table if not exists oauth_used_codes (
  jti text primary key,
  used_at timestamptz not null default now()
);
-- Service-role only; no RLS policies needed (only the token endpoint touches it).
alter table oauth_used_codes enable row level security;
