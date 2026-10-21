-- Durable event outbox. Only the service role reads/writes it; MCP applies
-- verified household scoping. Existing alerts are deliberately not backfilled.
create table public.mcp_events (
  sequence integer generated always as identity primary key,
  event_id uuid not null unique references public.alerts(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (name = 'budget.threshold_crossed'),
  category_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  data jsonb not null
);
create index mcp_events_household_sequence on public.mcp_events(household_id, sequence);
alter table public.mcp_events enable row level security;
revoke all on public.mcp_events from anon, authenticated;
grant select, insert, delete on public.mcp_events to service_role;
grant usage on sequence public.mcp_events_sequence_seq to service_role;

create function public.capture_mcp_budget_event() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Serialize sequence allocation per household until commit. A poll cursor
  -- cannot jump over an uncommitted earlier event in the same household.
  perform pg_advisory_xact_lock(hashtextextended(new.household_id::text, 702619));
  insert into public.mcp_events(event_id, household_id, name, category_id, data)
  values (new.id, new.household_id, 'budget.threshold_crossed', new.category_id,
    jsonb_build_object('categoryId', new.category_id, 'periodStart', new.period_start,
      'state', new.state, 'target', new.payload->'target',
      'netSpent', new.payload->'netSpent', 'pct', new.payload->'pct'));
  return new;
end;
$$;
revoke all on function public.capture_mcp_budget_event() from public, anon, authenticated;
grant execute on function public.capture_mcp_budget_event() to service_role;
create trigger capture_mcp_budget_event after insert on public.alerts
for each row when (new.type in ('cap_warning', 'cap_breach'))
execute function public.capture_mcp_budget_event();
