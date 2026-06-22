-- Introduce a fifth budget kind, 'savings', for contribution-style budgets where
-- moving money OUT to a saver is the goal (not a sinking fund you spend down).
-- Re-key Savings Out + Investments (groups 'Savings'/'Investments') from 'reserve'.
-- See docs/superpowers/specs/2026-06-07-savings-budget-kind-design.md.

-- Widen the kind CHECK on all three tables that constrain it.
alter table budgets drop constraint if exists budgets_kind_check;
alter table budgets add constraint budgets_kind_check
  check (kind = any (array['monthly_cap','reserve','ap_amortised','income','savings']));

alter table categories drop constraint if exists categories_kind_check;
alter table categories add constraint categories_kind_check
  check (kind in ('monthly_cap','reserve','ap_amortised','income','transfer','business_subsidy','system','savings'));

alter table budget_periods drop constraint if exists budget_periods_kind_check;
alter table budget_periods add constraint budget_periods_kind_check
  check (kind in ('monthly_cap','reserve','ap_amortised','income','savings'));

-- Re-key the two contribution budgets + their categories. Scoped by group so it
-- captures exactly Savings Out (Savings) and Investments (Investments), and stays
-- correct if more contribution categories land in those groups later.
update categories
   set kind = 'savings'
 where kind = 'reserve'
   and "group" in ('Savings', 'Investments');

update budgets b
   set kind = 'savings'
  from categories c
 where c.id = b.category_id
   and b.kind = 'reserve'
   and c."group" in ('Savings', 'Investments');
