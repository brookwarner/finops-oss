-- Starter taxonomy + categorisation rules for NEW households (OSS users, new
-- devs, the demo) so auto-categorisation — the make-or-break feature — works out
-- of the box WITHOUT importing anyone's PocketSmith export.
--
-- Design: extend the existing `seed_default_categories()` trigger (fires
-- `after insert on households`, see 0002) so every freshly-created household is
-- born with a generic personal-finance taxonomy and a set of high-precision
-- national-chain rules. We deliberately seed NO budgets — monthly targets are
-- personal, so users set their own; the taxonomy + rules are what make the
-- categoriser useful immediately.
--
-- Prod impact: NONE. The trigger only fires on `households` INSERT. the owner's
-- household already exists (won't re-fire), and 0033 makes subsequent signups
-- JOIN the existing household rather than create one — so this branch never runs
-- in the live single-household deployment. It only benefits fresh DBs.
--
-- Merchant values are lifted from the proven curated set (0015) — they match
-- Akahu's enriched `merchant.name` exactly (the engine's `exact` rule is a
-- case-sensitive equality), and only nationwide chains are kept (the owner's
-- branch-local merchants are dropped). source='starter' so they're
-- distinguishable from manual/llm/bootstrap/curated and regeneratable.

-- 1. Allow the new rule provenance.
alter table category_rules drop constraint category_rules_source_check;
alter table category_rules
  add constraint category_rules_source_check
  check (source in ('manual', 'llm', 'bootstrap', 'curated', 'starter'));

-- 2. Replace the per-household seed function: Uncategorised (as before) + a
--    generic taxonomy + national-chain starter rules. Idempotent on the
--    category natural key so it can't double-seed or fight a later upsert
--    (e.g. the demo seeder).
create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hh uuid := new.id;
begin
  -- System bucket (unchanged behaviour).
  insert into categories (household_id, name, kind, "group", context)
  values (hh, 'Uncategorised', 'system', 'System', 'personal')
  on conflict (household_id, name) do nothing;

  -- Generic taxonomy. (name, group, kind, spend_class) — spend_class is null for
  -- income/transfer/savings (not a spend line); the app treats null as essential.
  insert into categories (household_id, name, "group", kind, context, spend_class)
  select hh, v.name, v.grp, v.kind, 'personal', v.spend_class
  from (values
    -- Income
    ('Salary',                    'Income',        'income',       null),
    ('Other Income',              'Income',        'income',       null),
    ('Interest Income',           'Income',        'income',       null),
    -- Food
    ('Groceries',                 'Food',          'monthly_cap',  'essential'),
    ('Restaurants/Dining/Snacks', 'Food',          'monthly_cap',  'discretionary'),
    -- Transport
    ('Gasoline/Fuel',             'Transport',     'monthly_cap',  'essential'),
    ('Public Transport',          'Transport',     'monthly_cap',  'essential'),
    ('Parking',                   'Transport',     'monthly_cap',  'essential'),
    ('Vehicles',                  'Transport',     'reserve',      'essential'),
    -- Discretionary
    ('Entertainment',             'Discretionary', 'monthly_cap',  'discretionary'),
    ('Online Services',           'Discretionary', 'monthly_cap',  'discretionary'),
    ('General Merchandise',       'Discretionary', 'monthly_cap',  'discretionary'),
    ('Clothing/Shoes',            'Discretionary', 'reserve',      'discretionary'),
    ('Alcohol',                   'Discretionary', 'monthly_cap',  'discretionary'),
    ('Gifts',                     'Discretionary', 'reserve',      'discretionary'),
    ('Holidays',                  'Discretionary', 'reserve',      'discretionary'),
    ('Hobbies',                   'Discretionary', 'monthly_cap',  'discretionary'),
    -- Wellbeing
    ('Healthcare/Medical',        'Wellbeing',     'reserve',      'essential'),
    ('Haircuts',                  'Wellbeing',     'reserve',      'discretionary'),
    ('Pets/Pet Care',             'Wellbeing',     'monthly_cap',  'discretionary'),
    -- Home
    ('Home Maintenance',          'Home',          'reserve',      'essential'),
    ('Home Improvement',          'Home',          'reserve',      'discretionary'),
    -- Utilities
    ('Power',                     'Utilities',     'ap_amortised', 'essential'),
    ('Water',                     'Utilities',     'ap_amortised', 'essential'),
    ('Telephone Services',        'Utilities',     'ap_amortised', 'essential'),
    ('Rates',                     'Utilities',     'ap_amortised', 'essential'),
    ('Service Charges/Fees',      'Utilities',     'ap_amortised', 'essential'),
    -- Fixed obligations
    ('Insurance',                 'Fixed',         'ap_amortised', 'essential'),
    ('Donations',                 'Fixed',         'ap_amortised', 'essential'),
    ('Rent/Mortgage',             'Fixed',         'ap_amortised', 'essential'),
    ('Credit Card Repayments',    'Fixed',         'transfer',     null),
    -- Kids
    ('Education',                 'Kids',          'monthly_cap',  'essential'),
    ('Sports & Recreation',       'Kids',          'monthly_cap',  'discretionary'),
    -- Savings & investments
    ('Savings',                   'Savings',       'savings',      null),
    ('Investments',               'Savings',       'savings',      null)
  ) as v(name, grp, kind, spend_class)
  on conflict (household_id, name) do nothing;

  -- Salary is the regular paycheque; tag it so income views treat it as such.
  update categories set income_type = 'salary'
  where household_id = hh and name = 'Salary';

  -- National-chain starter rules (exact match on Akahu merchant.name, priority 50).
  -- Joined to the just-seeded categories by name; an unmatched cat_name silently
  -- contributes no rule, so the migration's coherence is asserted by a test.
  insert into category_rules (household_id, category_id, match_type, match_value, field, priority, source)
  select hh, c.id, 'exact', r.merchant, 'merchant', 50, 'starter'
  from (values
    -- Fuel
    ('BP',                  'Gasoline/Fuel'),
    ('Gull',                'Gasoline/Fuel'),
    ('Mobil',               'Gasoline/Fuel'),
    ('Z Energy',            'Gasoline/Fuel'),
    ('Caltex',              'Gasoline/Fuel'),
    -- Groceries
    ('Pak''nSave',          'Groceries'),
    ('Countdown',           'Groceries'),
    ('Woolworths',          'Groceries'),
    ('FreshChoice',         'Groceries'),
    ('New World',           'Groceries'),
    ('Four Square',         'Groceries'),
    -- Dining (national chains only)
    ('McDonald''s',         'Restaurants/Dining/Snacks'),
    ('Domino''s',           'Restaurants/Dining/Snacks'),
    ('Burger Fuel',         'Restaurants/Dining/Snacks'),
    -- Transit
    ('Auckland Transport',  'Public Transport'),
    ('Wilson Parking',      'Parking'),
    ('NZTA',                'Vehicles'),
    ('Repco',               'Vehicles'),
    -- Online services / subscriptions
    ('Disney',              'Online Services'),
    ('Kindle',              'Online Services'),
    ('Spotify',             'Online Services'),
    ('Netflix',             'Online Services'),
    ('Apple',               'Online Services'),
    -- Telco
    ('One NZ',              'Telephone Services'),
    ('Spark',               'Telephone Services'),
    ('2degrees',            'Telephone Services'),
    -- Utilities
    ('Meridian Energy',     'Power'),
    ('Powershop',           'Power'),
    ('Watercare',           'Water'),
    -- Insurance
    ('AIA New Zealand',     'Insurance'),
    ('Fidelity Life',       'Insurance'),
    ('AA Insurance',        'Insurance'),
    -- Alcohol
    ('Liquorland',          'Alcohol'),
    -- Retail
    ('Trade Me',            'General Merchandise'),
    ('Kmart',               'General Merchandise'),
    ('The Warehouse',       'General Merchandise'),
    ('AliExpress',          'General Merchandise'),
    ('Bunnings Warehouse',  'Home Improvement'),
    ('Mitre 10',            'Home Improvement'),
    -- Recreation
    ('Rebel Sport',         'Sports & Recreation'),
    -- Health
    ('Chemist Warehouse',   'Healthcare/Medical'),
    -- Donations
    ('World Vision',        'Donations'),
    -- Council / rates
    ('Auckland Council',    'Rates'),
    -- Investments
    ('Sharesies',           'Investments')
  ) as r(merchant, cat_name)
  join categories c on c.household_id = hh and c.name = r.cat_name;

  return new;
end;
$$;
