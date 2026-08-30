-- Give "Business Expenses" a real budget so the personal -> business top-ups to
-- Warner & the Wild show up on /budgets and can be tracked against a cap.
--
-- WHY THIS WAS MISSING
-- "Business Expenses" (and "Bush Base") are kind = 'business_subsidy'. The 0014
-- taxonomy seed only created a budgets row when the category kind was one the
-- budgets table accepts (monthly_cap | reserve | ap_amortised; later + income,
-- savings). business_subsidy is NOT an allowed budgets.kind, so the category
-- existed with no budget row and never appeared in list_budgets / set_budget_target.
-- (These top-ups were never treated as transfers — business_subsidy DOES count
-- as expense in the Position calc — they just had no cap to track against.)
--
-- THE SHAPE
-- We attach a kind = 'monthly_cap' budget row to the existing business_subsidy
-- category (the same category-kind / budget-kind split the mortgage uses).
-- compute.ts builds rows straight from the budgets table without gating on
-- category.kind, so it renders as an ordinary cap, while the category keeps its
-- business_subsidy semantics (FI tile + subscription-radar exclusions intact).
--
-- THE TARGET
-- $1,138.33/mo = 2026 YTD spend to Warner & the Wild annualised / 12. Jan–Jun 2026
-- totalled $6,830 (6 x $170 insurance + ad-hoc bill top-ups: 1000, 1000, 1000,
-- 865, 865, 400, 200, 200, 150, 70, 60); $6,830 / 6 months = $1,138.33/mo.
-- the owner edits in-app.
--
-- GOING-FORWARD CATEGORISATION
-- Also (re)asserts the 'warner and the w' -> Business Expenses rule at priority 45
-- so future top-ups beat the 0016 bootstrap '1330WARNER AND T' -> Bush Base rule
-- (priority 94; engine is priority-asc, first-match-wins). Historical rows already
-- sitting in Bush Base are left as-is (going-forward only, per the owner).
--
-- Idempotent; household-guarded; no-ops on a fresh / OSS DB.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  cat_id uuid;
begin
  if not exists (select 1 from households where id = hh) then return; end if;

  select id into cat_id
    from categories
   where household_id = hh and name = 'Business Expenses';
  if cat_id is null then return; end if;

  -- Budget row (monthly_cap over the business_subsidy category).
  insert into budgets (household_id, category_id, kind, monthly_target, active)
  values (hh, cat_id, 'monthly_cap', 1138.33, true)
  on conflict (household_id, category_id) do update
    set kind           = excluded.kind,
        monthly_target = excluded.monthly_target,
        active         = true;

  -- Going-forward categorisation rule (priority 45 beats the bootstrap 94).
  -- NOT EXISTS guard keeps it idempotent regardless of the rule-dedup index shape.
  insert into category_rules (household_id, category_id, match_type, match_value, field, priority, source)
  select hh, cat_id, 'pattern', 'warner and the w', 'description', 45, 'manual'
  where not exists (
    select 1 from category_rules
     where household_id = hh
       and match_type   = 'pattern'
       and match_value  = 'warner and the w'
       and field        = 'description'
  );
end $$;
