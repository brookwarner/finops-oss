-- Phase 2 of the mortgage P&I view: explicit per-tranche loan terms.
-- ----------------------------------------------------------------------------
-- The P&I view (src/lib/mortgage/pi.ts) can *estimate* rate and payoff from the
-- transaction feed, but rates and fixed-until dates exist in no Akahu feed. This
-- table captures them so payoff becomes contractual-accurate (not derived), refix
-- timing is known, and fix-vs-float / extra-repayment scenarios can be modelled.
--
-- A handful of hand-maintained rows — the one place the project's "no manual
-- entry" ethos bends, justified because the data simply isn't ingestible. Update
-- a row at each refix.
--
-- Join to the computed P&I tranches is by `repayment` proximity (the observed
-- monthly gross payment), so it does NOT depend on bank account naming.
-- `account_id` is captured opportunistically for future precision but the view
-- does not rely on it. `kind`:
--   'table'     — amortising P&I tranche (Loan Part 1/2/3).
--   'revolving' — interest-only / non-reducing facility (the revolving credit
--                 account); never self-amortises, surfaced as a flagged caveat.

create table mortgage_parts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  label text not null,
  kind text not null default 'table' check (kind in ('table', 'revolving')),
  rate numeric(6,3),               -- annual debit interest rate, % p.a. (null = floating/unknown)
  fixed_until date,                -- end of the current fixed term (null = floating/revolving)
  repayment numeric(12,2),         -- scheduled repayment per period (null = interest-only)
  repayment_freq text not null default 'monthly',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, label)
);

create index mortgage_parts_household_id_idx on mortgage_parts(household_id);

alter table mortgage_parts enable row level security;

create policy "members can read mortgage parts in their household"
  on mortgage_parts for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = mortgage_parts.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can write mortgage parts in their household"
  on mortgage_parts for all
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = mortgage_parts.household_id and hm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from household_members hm
      where hm.household_id = mortgage_parts.household_id and hm.user_id = auth.uid()
    )
  );

-- Seed example loan terms (replace with your own from your bank app).
-- account_id resolved by best-effort name match; left null if the account is
-- named differently in our DB (the view still joins by repayment amount).
-- Idempotent on (household_id, label).
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
begin
  insert into mortgage_parts (household_id, account_id, label, kind, rate, fixed_until, repayment, notes)
  values
    (hh, (select id from accounts where household_id = hh and name ilike '%part 1%' limit 1),
      'Loan Part 1', 'table', 5.00, date '2028-01-01', 1200.00,
      '30y table loan'),
    (hh, (select id from accounts where household_id = hh and name ilike '%part 2%' limit 1),
      'Loan Part 2', 'table', 5.00, date '2028-01-01', 1200.00,
      '30y table loan'),
    (hh, (select id from accounts where household_id = hh and name ilike '%part 3%' limit 1),
      'Loan Part 3', 'table', 5.00, date '2028-06-01', 1200.00,
      '30y table loan'),
    (hh, (select id from accounts where household_id = hh and name ilike '%revolving%' limit 1),
      'Revolving credit', 'revolving', null, null, null,
      'Non-reducing / interest-only; $50,000 limit. Floating rate.')
  on conflict (household_id, label) do update
    set account_id = excluded.account_id,
        kind = excluded.kind,
        rate = excluded.rate,
        fixed_until = excluded.fixed_until,
        repayment = excluded.repayment,
        notes = excluded.notes,
        updated_at = now();
end $$;
