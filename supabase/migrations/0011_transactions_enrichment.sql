-- Hoist Akahu enrichment fields out of raw jsonb into typed columns so the
-- PWA can render fast without parsing raw on every row.
--
-- Sign convention change: previously "positive = outflow". Now we store
-- transactions.amount exactly as Akahu returns it (positive = balance
-- increases on this account). Conversion to "outflow" is account-type
-- aware: for asset accounts (checking/savings) outflow = -amount; for
-- liability accounts (credit_card/loan/mortgage) outflow = +amount. The
-- transactions table is empty so this is a column-comment change only.

alter table public.transactions
  add column akahu_type text not null default 'UNKNOWN',
  add column akahu_merchant_id text,
  add column merchant_logo_url text,
  add column particulars text,
  add column code text,
  add column reference text,
  add column other_account text,
  add column card_suffix text,
  add column conversion jsonb,
  add column balance_after numeric(14,2),
  add column akahu_category_id text references public.akahu_categories(id) on delete set null,
  add column last_seen_at timestamptz not null default now();

alter table public.transactions drop column akahu_category;

alter table public.transactions alter column akahu_type drop default;

create index transactions_akahu_category_id_idx on public.transactions(akahu_category_id);
create index transactions_household_last_seen_idx on public.transactions(household_id, last_seen_at);
