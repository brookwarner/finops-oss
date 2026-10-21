-- Dots-compatible webhook subscriptions. Secrets are encrypted by the app.
create table public.mcp_event_subscriptions (
  id text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text,
  name text not null check (name = 'budget.threshold_crossed'),
  category_id uuid,
  callback_url text not null,
  secret_ciphertext text not null,
  verified_until timestamptz not null,
  expires_at timestamptz not null,
  last_sequence integer not null default 0,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_status integer,
  last_error text,
  delivered_count integer not null default 0,
  failed_count integer not null default 0
);
create index mcp_event_subscriptions_due on public.mcp_event_subscriptions(next_attempt_at);
alter table public.mcp_event_subscriptions enable row level security;
revoke all on public.mcp_event_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.mcp_event_subscriptions to service_role;

create function public.save_mcp_event_subscription(p jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  -- Use the same lock as capture to establish a committed starting position.
  perform pg_advisory_xact_lock(hashtextextended(p->>'household_id', 702619));
  insert into public.mcp_event_subscriptions
    (id, household_id, user_id, token_hash, name, category_id, callback_url,
     secret_ciphertext, verified_until, expires_at, last_sequence)
  values (p->>'id', (p->>'household_id')::uuid, (p->>'user_id')::uuid,
    p->>'token_hash', p->>'name', (p->>'category_id')::uuid, p->>'callback_url',
    p->>'secret_ciphertext', (p->>'verified_until')::timestamptz,
    (p->>'expires_at')::timestamptz,
    coalesce((select max(sequence) from public.mcp_events where household_id = (p->>'household_id')::uuid), 0))
  on conflict (id) do update set
    token_hash = excluded.token_hash, secret_ciphertext = excluded.secret_ciphertext,
    verified_until = excluded.verified_until, expires_at = excluded.expires_at;
end;
$$;

create function public.claim_mcp_event_subscription() returns setof public.mcp_event_subscriptions
language sql security invoker set search_path = '' as $$
  update public.mcp_event_subscriptions set lease_id = gen_random_uuid(), lease_until = now() + interval '90 seconds'
  where id = (select id from public.mcp_event_subscriptions
    where expires_at > now() and next_attempt_at <= now()
      and (lease_until is null or lease_until < now())
    order by next_attempt_at for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.save_mcp_event_subscription(jsonb) from public, anon, authenticated;
revoke all on function public.claim_mcp_event_subscription() from public, anon, authenticated;
grant execute on function public.save_mcp_event_subscription(jsonb) to service_role;
grant execute on function public.claim_mcp_event_subscription() to service_role;
