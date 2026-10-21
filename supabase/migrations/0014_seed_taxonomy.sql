-- Example taxonomy seed for a single household. Idempotent: upserts by
-- (household_id, name). Mirrors the categories described in docs/design.md
-- "Seed taxonomy". Monthly targets here are illustrative round example
-- amounts — replace with your own budget figures.
--
-- Locked to a single example household_id. If you re-run this for another
-- household, change the constant at the top.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  rec record;
  cat_id uuid;
begin
  -- (name, group, kind, context, monthly_target_or_null)
  for rec in
    select * from (values
      -- Income
      ('Salary',                  'Income',        'income',            'personal',     null::numeric),
      ('Other Income',            'Income',        'income',            'personal',     null),
      ('Secondary Income',        'Income',        'income',            'personal',     null),
      ('Interest Income',         'Income',        'income',            'personal',     null),
      ('Business Income',         'Income',        'income',            'business',     null),

      -- Food
      ('Groceries',               'Food',          'monthly_cap',       'personal',     800.00),
      ('Restaurants/Dining/Snacks','Food',         'monthly_cap',       'personal',     300.00),

      -- Discretionary
      ('Entertainment',           'Discretionary', 'monthly_cap',       'personal',     50.00),
      ('Hobbies',                 'Discretionary', 'monthly_cap',       'personal',     100.00),
      ('Date Nights',             'Discretionary', 'monthly_cap',       'personal',     100.00),
      ('Clothing/Shoes',          'Discretionary', 'reserve',      'personal',     50.00),
      ('General Merchandise',     'Discretionary', 'monthly_cap',       'personal',     50.00),
      ('Online Services',         'Discretionary', 'monthly_cap',       'personal',     100.00),
      ('Alcohol',                 'Discretionary', 'monthly_cap',       'personal',     100.00),
      ('Gifts',                   'Discretionary', 'reserve',      'personal',     50.00),
      ('Holidays',                'Discretionary', 'reserve',      'personal',     50.00),

      -- Kids
      ('Education',               'Kids',          'monthly_cap',       'personal',     100.00),
      ('Sports & Recreation',     'Kids',          'monthly_cap',       'personal',     150.00),
      ('Allowances',              'Kids',          'monthly_cap',       'personal',     20.00),

      -- Wellbeing
      ('Healthcare/Medical',      'Wellbeing',     'reserve',      'personal',     100.00),
      ('Pets/Pet Care',           'Wellbeing',     'monthly_cap',       'personal',     100.00),
      ('Haircuts',                'Wellbeing',     'reserve',      'personal',     50.00),

      -- Transit
      ('Public Transport',        'Transit',       'monthly_cap',       'personal',     20.00),
      ('Gasoline/Fuel',           'Transit',       'monthly_cap',       'personal',     400.00),
      ('Parking',                 'Transit',       'monthly_cap',       'personal',     10.00),

      -- Maintenance
      ('Home Maintenance',        'Maintenance',   'reserve',      'personal',     50.00),
      ('Vehicles',                'Maintenance',   'reserve',      'personal',     50.00),
      ('Home Improvement',        'Maintenance',   'reserve',      'personal',     50.00),

      -- Utilities (ap_amortised)
      ('Power',                   'Utilities',     'ap_amortised',      'personal',     300.00),
      ('Water',                   'Utilities',     'ap_amortised',      'personal',     20.00),
      ('Telephone Services',      'Utilities',     'ap_amortised',      'personal',     150.00),
      ('Rates',                   'Utilities',     'ap_amortised',      'personal',     250.00),
      ('Service Charges/Fees',    'Utilities',     'ap_amortised',      'personal',     10.00),

      -- Fixed obligations
      ('Insurance',               'Fixed',         'ap_amortised',      'personal',     350.00),
      ('Caravan Repayments',      'Fixed',         'ap_amortised',      'personal',     250.00),
      ('Donations',               'Fixed',         'ap_amortised',      'personal',     100.00),
      ('Credit Card Repayments',  'Fixed',         'transfer',          'personal',     null),
      ('Debt Repayments',         'Fixed',         'ap_amortised',      'personal',     null),

      -- Mortgage
      ('Mortgage Interest',       'Mortgage',      'ap_amortised',      'personal',     1500.00),
      ('Mortgage Part 1',         'Mortgage',      'ap_amortised',      'personal',     1200.00),
      ('Mortgage Part 2',         'Mortgage',      'ap_amortised',      'personal',     1200.00),
      ('Mortgage Part 3',         'Mortgage',      'ap_amortised',      'personal',     1200.00),

      -- Investments / Savings (sinking)
      ('Investments',             'Investments',   'reserve',      'personal',     100.00),
      ('Savings Out',             'Savings',       'reserve',      'personal',     400.00),

      -- Business subsidy
      ('Business Base',           'Business',      'business_subsidy',  'business',     200.00),
      ('Business Expenses',       'Business',      'business_subsidy',  'business',     50.00),

      -- Movement / system
      ('Transfers',               'System',        'transfer',          'personal',     null),
      ('Taxes',                   'System',        'ap_amortised',      'personal',     5.00)
    ) as t(name, grp, kind, context, monthly_target)
  loop
    insert into categories (household_id, name, "group", kind, context)
    values (hh, rec.name, rec.grp, rec.kind, rec.context)
    on conflict (household_id, name) do update
      set "group" = excluded."group",
          kind   = excluded.kind,
          context = excluded.context
    returning id into cat_id;

    -- Seed a budget row only if the category has a monthly target AND a kind
    -- that the budgets table accepts.
    if rec.monthly_target is not null
       and rec.kind in ('monthly_cap','reserve','ap_amortised') then
      insert into budgets (household_id, category_id, kind, monthly_target)
      values (hh, cat_id, rec.kind, rec.monthly_target)
      on conflict (household_id, category_id) do update
        set kind = excluded.kind,
            monthly_target = excluded.monthly_target;
    end if;
  end loop;
end $$;
