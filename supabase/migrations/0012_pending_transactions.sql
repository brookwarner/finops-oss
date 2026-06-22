-- Pending transactions are a different beast: no stable ID, no enrichment,
-- and they resolve into posted transactions later as a separate event
-- (not an update). So we keep them in their own table and use a
-- wipe-and-replace pattern per account on each poll.
create table public.pending_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  occurred_at timestamptz not null,
  amount numeric(14,2) not null,
  akahu_type text not null,
  description text,
  raw jsonb not null,
  last_seen_at timestamptz not null default now()
);

create index pending_transactions_account_id_idx on public.pending_transactions(account_id);
create index pending_transactions_household_id_idx on public.pending_transactions(household_id);

alter table public.pending_transactions enable row level security;

create policy "members can read pending in their household"
  on public.pending_transactions for select
  using (
    exists (
      select 1 from public.household_members hm
      where hm.household_id = pending_transactions.household_id and hm.user_id = auth.uid()
    )
  );
