-- LLM-sourced rules carry their confidence for auditing / later sweeps.
alter table public.category_rules add column confidence numeric null;

-- Transactions flagged as awaiting review of a Claude suggestion.
alter table public.transactions add column needs_review boolean not null default false;

create index transactions_needs_review_idx
  on public.transactions(household_id, needs_review) where needs_review;

-- The learning loop and LLM cache upsert rules keyed on
-- (household_id, match_type, match_value, field). Dedupe any existing
-- collisions (bootstrap + curated can overlap), keeping one row per group,
-- then enforce uniqueness so ON CONFLICT upserts are reliable.
delete from public.category_rules a
using public.category_rules b
where a.household_id = b.household_id
  and a.match_type = b.match_type
  and a.match_value = b.match_value
  and a.field = b.field
  and a.ctid > b.ctid;

create unique index category_rules_dedup_idx
  on public.category_rules(household_id, match_type, match_value, field);
