-- 0021_income_budgets.sql
-- Give the five income categories real budget rows so they appear in the
-- Budgets page (incl. Flow > Income). Targets are illustrative example values,
-- edited in-app. First widen the kind check to permit 'income'.

alter table budgets drop constraint if exists budgets_kind_check;
alter table budgets add constraint budgets_kind_check
  check (kind = any (array['monthly_cap','reserve','ap_amortised','income']));

insert into budgets (household_id, category_id, kind, monthly_target, active)
select
  c.household_id,
  c.id,
  'income',
  case c.name
    when 'Salary'           then 9000
    when 'Secondary Income' then 500
    when 'Business Income'  then 150
    when 'Other Income'     then 100
    when 'Interest Income'  then 15
    else 0
  end,
  true
from categories c
where c.kind = 'income'
  and not exists (
    select 1 from budgets b where b.category_id = c.id
  );
