-- Example categorisation rules. Replace with your own (see scripts/bootstrap_rules.py).
-- Bootstrap category_rules from a categorised transaction export.
-- These are illustrative description-pattern rules covering common categories;
-- the real generator derives them from your own transaction history.

delete from category_rules where household_id = '00000000-0000-0000-0000-000000000001' and source = 'bootstrap';
insert into category_rules (household_id, category_id, match_type, match_value, field, priority, source)
select
  '00000000-0000-0000-0000-000000000001'::uuid, c.id, 'pattern', v.stem, 'description', v.priority, 'bootstrap'
from categories c
join (values
  ('COUNTDOWN',         'Groceries', 90),
  ('NEW WORLD',         'Groceries', 90),
  ('PAK N SAVE',        'Groceries', 90),
  ('Z ENERGY',          'Gasoline/Fuel', 90),
  ('BP CONNECT',        'Gasoline/Fuel', 90),
  ('MCDONALDS',         'Restaurants/Dining/Snacks', 90),
  ('UBER EATS',         'Restaurants/Dining/Snacks', 90),
  ('MERIDIAN ENERGY',   'Power', 90),
  ('WATERCARE',         'Water', 90),
  ('SPARK',             'Telephone Services', 90),
  ('NETFLIX',           'Online Services', 90),
  ('SPOTIFY',           'Online Services', 90),
  ('THE WAREHOUSE',     'General Merchandise', 90),
  ('BUNNINGS',          'Home Improvement', 90),
  ('CHEMIST WAREHOUSE', 'Healthcare/Medical', 90),
  ('SALARY',            'Salary', 90),
  ('INTERNAL TRANSFER', 'Transfers', 90),
  ('CREDIT CARD PAYMENT','Credit Card Repayments', 90),
  ('SHARESIES',         'Investments', 90),
  ('INTEREST EARNED',   'Interest Income', 90)
) as v(stem, cat_name, priority) on v.cat_name = c.name
where c.household_id = '00000000-0000-0000-0000-000000000001';
