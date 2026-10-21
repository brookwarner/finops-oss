-- Layer 1 of M2 categorisation: curated exact-merchant rules against Akahu's
-- enriched `merchant.name` field. Priority 50 (runs before the layer-2
-- pattern rules at priority 100). Source 'curated' so it survives bootstrap
-- regenerations.
--
-- These are illustrative example rules. Replace the merchant list with the
-- merchants that show up in your own transaction feed.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  rec record;
  cat_id uuid;
begin
  delete from category_rules where household_id = hh and source = 'curated';

  for rec in
    select * from (values
      -- Fuel
      ('BP',                          'Gasoline/Fuel'),
      ('Z Energy',                    'Gasoline/Fuel'),
      -- Groceries
      ('Countdown',                   'Groceries'),
      ('New World',                   'Groceries'),
      ('Pak''nSave',                  'Groceries'),
      -- Restaurants / dining
      ('McDonald''s',                 'Restaurants/Dining/Snacks'),
      ('Uber Eats',                   'Restaurants/Dining/Snacks'),
      -- Online services / subscriptions
      ('Netflix',                     'Online Services'),
      ('Spotify',                     'Online Services'),
      -- Telco
      ('Spark',                       'Telephone Services'),
      -- Utilities
      ('Meridian Energy',             'Power'),
      ('Watercare',                   'Water'),
      -- Retail
      ('The Warehouse',               'General Merchandise'),
      ('Bunnings Warehouse',          'Home Improvement'),
      -- Investments / banking
      ('Sharesies',                   'Investments')
    ) as t(merchant, cat_name)
  loop
    insert into category_rules
      (household_id, category_id, match_type, match_value, field, priority, source)
    select hh, c.id, 'exact', rec.merchant, 'merchant', 50, 'curated'
    from categories c
    where c.household_id = hh and c.name = rec.cat_name;
  end loop;
end $$;
