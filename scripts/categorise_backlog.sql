-- Backfill: clear the uncategorised PocketSmith-import backlog.
--
-- ROOT CAUSE
-- scripts/import_pocketsmith.py set is_manual_category = true on EVERY imported
-- row (to protect PocketSmith's own categorisations from the auto-engine). But
-- rows whose CSV category was blank, a parent-group name (Discretionary, Kids,
-- Wellbeing, Maintenance, Transit, Utilities -> mapped to null), or an unmapped
-- label landed with category_id = null AND is_manual_category = true. That combo
-- is a contradiction: the auto-categoriser (engine.ts + nightly LLM) skips any
-- row with is_manual_category = true, so 961 rows sat permanently uncategorised
-- and silently suppressed monthly spend totals (esp. Dec 2025 - Apr 2026, which
-- broke the budget-vs-actual comparison).
--
-- The PocketSmith "categorized" CSV exports only run through 2025-10-14, so the
-- focus-window rows (Dec-Apr) post-date the export and their original categories
-- are NOT recoverable from CSV. Hence reusable rule-based categorisation instead.
--
-- WHAT THIS DOES (idempotent; safe to re-run)
--   1. Adds curated description-pattern rules (priority 45, source 'curated').
--   2. Applies the FULL ruleset to every uncategorised row in engine order
--      (priority asc, first match wins; longest match_value breaks ties),
--      setting category_id and clearing is_manual_category so the engine owns them.
--   3. Flips any still-unmatched rows to is_manual_category = false so the nightly
--      LLM categoriser can claim the long tail.
--
-- Merchant->category calls confirmed with the owner (2026-06-03):
--   moveitmama -> Healthcare/Medical, squareone -> Allowances,
--   ADAPT -> Education, "Warner and the Wild" -> Business Expenses
--   (business_subsidy: tracks how much personal cashflow props up the business;
--    see docs/design.md "Business subsidy"). Internal transfers/savings -> Transfers,
--   wages -> Salary / Partner ECE Income.

begin;

-- 1. Curated pattern rules (tier 1 + tier 2). ----------------------------------
with newrules(match_value, cat_name) as (values
  -- Healthcare / Medical
  ('physioth','Healthcare/Medical'),('chemist warehouse','Healthcare/Medical'),
  ('westview pharmacy','Healthcare/Medical'),('westview medi','Healthcare/Medical'),
  ('moveitmama','Healthcare/Medical'),
  -- Restaurants / Dining / Snacks
  ('obc cafe','Restaurants/Dining/Snacks'),('cheeky bean','Restaurants/Dining/Snacks'),
  ('deco eatery','Restaurants/Dining/Snacks'),('sushi tomi','Restaurants/Dining/Snacks'),
  ('burger burger','Restaurants/Dining/Snacks'),('momento espresso','Restaurants/Dining/Snacks'),
  ('coca-cola ep','Restaurants/Dining/Snacks'),('burchies fried','Restaurants/Dining/Snacks'),
  ('wenly','Restaurants/Dining/Snacks'),('parr cross bakery','Restaurants/Dining/Snacks'),
  ('topwell bakery','Restaurants/Dining/Snacks'),('me & mrs jones','Restaurants/Dining/Snacks'),
  ('mcdonald','Restaurants/Dining/Snacks'),('spudsters','Restaurants/Dining/Snacks'),
  -- General Merchandise
  ('the warehouse','General Merchandise'),('kmart','General Merchandise'),('k-mart','General Merchandise'),
  ('trademe','General Merchandise'),('aliexpress','General Merchandise'),
  ('amazon marketplac','General Merchandise'),('alipaysinga','General Merchandise'),
  ('toyworld','General Merchandise'),
  -- Groceries
  ('boric food market','Groceries'),('fresh & more','Groceries'),('free rangers','Groceries'),
  -- Transit
  ('mobil glen eden','Gasoline/Fuel'),('z green bay','Gasoline/Fuel'),('mobil','Gasoline/Fuel'),
  ('aucklandtransport','Public Transport'),('at public transpo','Public Transport'),
  ('at sunnyvale','Public Transport'),
  -- Home / Vehicles
  ('mitre','Home Improvement'),('repco','Vehicles'),('glen mbgk service','Vehicles'),('nzta cps','Vehicles'),
  -- Discretionary / Kids / Wellbeing
  ('google reading eggs','Education'),('adapt','Education'),
  ('linkedin','Online Services'),('google workspace','Online Services'),('noom','Online Services'),
  ('apple.com/bill','Online Services'),
  ('opportunity party','Donations'),('the opportunities','Donations'),
  ('generationzero','Donations'),('visionwest','Donations'),
  ('squareone','Allowances'),('cotton on kids','Clothing/Shoes'),
  ('rebel henderson','Sports & Recreation'),('arataki visitor','Sports & Recreation'),
  ('pt erin pool','Sports & Recreation'),('sea life kelly tarlton','Entertainment'),
  ('garage project','Alcohol'),('brewaucracy','Alcohol'),('piha bowling club','Alcohol'),
  ('animal eye centre','Pets/Pet Care'),('old school barbe','Haircuts'),
  -- Business subsidy
  ('warner and the w','Business Expenses'),
  -- Transfers (internal) and income
  ('wbc quick transfer','Transfers'),('savingsrc','Transfers'),('spending acc warner','Transfers'),
  ('bg warner asb','Transfers'),('loan repay final','Transfers'),
  ('renovation','Transfers'),('reno fund','Transfers'),
  ('kinz-wages','Partner ECE Income'),('kindergarten nz','Partner ECE Income'),
  ('soul machine','Salary')
)
insert into category_rules (household_id, category_id, match_type, match_value, field, priority, source, confidence)
select c.household_id, c.id, 'pattern', nr.match_value, 'description', 45, 'curated', 1.0
from newrules nr join categories c on c.name = nr.cat_name
on conflict (household_id, match_type, match_value, field) do nothing;

-- 2. Apply the full ruleset to uncategorised rows (engine order). --------------
with u as (
  select id, merchant, description from transactions where category_id is null
),
matched as (
  select distinct on (u.id) u.id, r.category_id
  from u
  join category_rules r on (
    (r.match_type = 'exact'   and r.field = 'merchant'    and u.merchant = r.match_value) or
    (r.match_type = 'exact'   and r.field = 'description' and u.description = r.match_value) or
    (r.match_type = 'pattern' and r.field = 'merchant'    and upper(u.merchant)    like '%' || upper(r.match_value) || '%') or
    (r.match_type = 'pattern' and r.field = 'description' and upper(u.description) like '%' || upper(r.match_value) || '%')
  )
  order by u.id, r.priority asc, length(r.match_value) desc
)
update transactions t
set category_id = m.category_id, is_manual_category = false
from matched m
where t.id = m.id;

-- 3. Unlock the unmatched long tail for the nightly LLM categoriser. -----------
update transactions
set is_manual_category = false
where category_id is null and is_manual_category = true;

commit;
