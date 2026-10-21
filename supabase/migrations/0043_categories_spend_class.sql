-- 0043 — per-category spend classification (essential vs discretionary).
-- Drives the cashflow game-plan's "bare essentials" floor and the discretionary
-- cut lever. Nullable; the engine treats NULL as 'essential' (conservative — an
-- unclassified cost is assumed unavoidable, so a scenario can't wish it away).
alter table categories add column if not exists spend_class text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_spend_class_check') then
    alter table categories add constraint categories_spend_class_check
      check (spend_class is null or spend_class in ('essential','discretionary'));
  end if;
end $$;

-- Seed defaults (only where unset). Essential = unavoidable; discretionary = pausable.
update categories set spend_class = 'essential' where spend_class is null and (
     name in ('Groceries','Power','Water','Rates','Service Charges/Fees','Telephone Services',
              'Mortgage Interest','Mortgage Part 1','Mortgage Part 2','Mortgage Part 3',
              'Gasoline/Fuel','Parking','Public Transport','Education','Insurance',
              'Debt Repayments','Healthcare/Medical','Taxes')
);

update categories set spend_class = 'discretionary' where spend_class is null and (
     "group" in ('Discretionary','Maintenance')
  or name in ('Restaurants/Dining/Snacks','Haircuts','Pets/Pet Care','Allowances',
              'Sports & Recreation','Donations','Caravan Repayments')
);
