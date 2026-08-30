-- Inbox-sweep keyword rules.
--
-- Captures recurring merchants surfaced while sweeping the inbox of imported
-- history. Those rows can have an empty `merchant` column (never enriched), so
-- the merchant-field rules in 0015 never fire on them — the only lever is
-- `description` pattern matching.
--
-- These are deliberately SPECIFIC substrings (not broad single tokens) so they
-- don't mis-fire on unrelated future transactions. Priority 45 so they run
-- before the bootstrap patterns (60–100) but alongside the curated layer.
-- These are illustrative examples — replace with your own keywords.
-- Idempotent via a NOT EXISTS guard: re-running is a no-op.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  rec record;
begin
  for rec in
    select * from (values
      -- Groceries
      ('superette',            'Groceries'),
      -- Restaurants / Dining / Snacks
      ('local cafe',           'Restaurants/Dining/Snacks'),
      ('corner bakery',        'Restaurants/Dining/Snacks'),
      -- Healthcare / Medical
      ('chemist warehouse',    'Healthcare/Medical'),
      ('medical centre',       'Healthcare/Medical'),
      -- Fuel
      ('mobil ',               'Gasoline/Fuel'),
      ('gull ',                'Gasoline/Fuel'),
      -- Clothing / Shoes
      ('cotton on',            'Clothing/Shoes'),
      -- General Merchandise
      ('aliexpress',           'General Merchandise')
    ) as t(match_value, cat_name)
  loop
    insert into category_rules
      (household_id, category_id, match_type, match_value, field, priority, source)
    select hh, c.id, 'pattern', rec.match_value, 'description', 45, 'curated'
    from categories c
    where c.household_id = hh and c.name = rec.cat_name
      and not exists (
        select 1 from category_rules r
        where r.household_id = hh and r.match_type = 'pattern'
          and r.match_value = rec.match_value and r.field = 'description'
      );
  end loop;
end $$;
