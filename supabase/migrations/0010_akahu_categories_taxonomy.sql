-- Akahu's NZFCC-based hierarchical category taxonomy. Stable IDs.
-- Populated lazily on first transaction ingest (or via a seed route
-- that calls /v1/categories). We reference these from transactions.
create table public.akahu_categories (
  id text primary key,
  name text not null,
  parent_id text references public.akahu_categories(id) on delete set null,
  groups jsonb,
  created_at timestamptz not null default now()
);

create index akahu_categories_parent_id_idx on public.akahu_categories(parent_id);

alter table public.akahu_categories enable row level security;

-- Taxonomy is shared across households.
create policy "authenticated can read akahu categories"
  on public.akahu_categories for select
  to authenticated
  using (true);
-- Writes are service-role only.
