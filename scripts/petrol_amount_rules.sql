-- Petrol fuel-vs-food rules, using the amount gate from migration 0019.
--
-- RUN AT MERGE TIME, coordinated with feat/cat-engine-completion — not before.
-- Two prerequisites that live outside this branch:
--   (a) The live DB / feat branch has a UNIQUE constraint
--       (household_id, match_type, match_value, field) on category_rules. Amount-
--       split rules need two rows on the SAME pattern (food <$20, fuel >=$20),
--       so that constraint must be widened to include the amount bounds. This
--       script does that with NULLS NOT DISTINCT so existing text-only rules
--       (min/max null) still dedupe as before.
--   (b) Any code that upserts rules with
--       onConflict: "household_id,match_type,match_value,field"
--       (categorise + nightly routes, on feat) must move to the 6-column target
--       "household_id,match_type,match_value,field,min_amount,max_amount".
--       Without (b) those upserts will error after this runs.
--
-- Policy (confirmed with the owner 2026-06-03): at a petrol station,
--   |amount| <  $20  -> Restaurants/Dining/Snacks  (a pie + coffee)
--   |amount| >= $20  -> Gasoline/Fuel               (a tank)

begin;

-- 1. Widen rule uniqueness to include the amount gate (NULLS NOT DISTINCT keeps
--    text-only rules deduping on the original 4 columns). Idempotent.
alter table category_rules
  drop constraint if exists category_rules_household_id_match_type_match_value_field_key;
drop index if exists category_rules_dedupe_idx;
create unique index category_rules_dedupe_idx
  on category_rules (household_id, match_type, match_value, field, min_amount, max_amount)
  nulls not distinct;

-- 2. Drop the amount-blind blanket petrol -> Fuel curated rules added during the
--    backlog backfill (scripts/categorise_backlog.sql) — they swallow the small
--    food visits.
delete from category_rules
where source = 'curated' and field = 'description'
  and min_amount is null and max_amount is null
  and match_value in ('mobil', 'mobil glen eden', 'z green bay', 'gull', 'caltex', 'bp connect');

-- 3. Insert amount-gated pairs: food (<$20) and fuel (>=$20) per station pattern.
with stations(match_value) as (values
  ('bp connect'), ('mobil'), ('gull'), ('caltex'), ('z green bay')
),
gated(match_value, cat_name, min_amount, max_amount) as (
  select s.match_value, 'Restaurants/Dining/Snacks', null::numeric, 20::numeric from stations s
  union all
  select s.match_value, 'Gasoline/Fuel', 20::numeric, null::numeric from stations s
)
insert into category_rules
  (household_id, category_id, match_type, match_value, field, priority, source, confidence, min_amount, max_amount)
select c.household_id, c.id, 'pattern', g.match_value, 'description', 44, 'curated', 1.0, g.min_amount, g.max_amount
from gated g
join categories c on c.name = g.cat_name
on conflict (household_id, match_type, match_value, field, min_amount, max_amount) do nothing;

commit;
