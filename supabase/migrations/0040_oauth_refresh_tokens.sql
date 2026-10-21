-- Rotation + reuse-detection store for OAuth refresh tokens.
--
-- The refresh token itself is a signed JWT (stateless), but we persist its jti
-- so the token endpoint can (a) rotate on every use, (b) detect replay of an
-- already-rotated token, and (c) revoke. A row exists per issued refresh token;
-- `rotated_at` is set the moment the token is exchanged. Exchanging a token whose
-- row is missing or already rotated is treated as invalid_grant.
create table if not exists oauth_refresh_tokens (
  jti text primary key,
  household_id text not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz
);

-- Service-role only; no RLS policies needed (only the token endpoint touches it).
alter table oauth_refresh_tokens enable row level security;

-- Lets a future cleanup job prune expired/rotated rows cheaply.
create index if not exists oauth_refresh_tokens_expires_at_idx
  on oauth_refresh_tokens (expires_at);
