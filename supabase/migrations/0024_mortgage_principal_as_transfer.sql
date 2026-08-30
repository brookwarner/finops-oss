-- Model the mortgage as: interest = expense, principal = transfer.
-- ----------------------------------------------------------------------------
-- Each loan tranche posts a GROSS repayment as a two-legged transfer: cash
-- out of the everyday account (e.g. -1200) mirrored by a credit into the loan
-- account (+1200), both categorised "Mortgage Part N". The interest is booked
-- SEPARATELY on the loan as the "Mortgage Interest" charge (~-892/tranche).
--
-- Counting the gross repayment (Mortgage Part 1/2/3 = $3,654/mo) AS spend on top
-- of the Mortgage Interest line ($2,700/mo) double-counts the interest, because
-- the interest is already inside the gross payment. Real mortgage cash out is
-- ~$3,654/mo, but the budget was showing ~$6,441.
--
-- Fix per the chosen model: reclassify the gross-repayment categories as
-- `transfer` so their two legs net out and drop out of "spend" everywhere
-- (Position card + budget rows + flex all already exclude `transfer`), and
-- deactivate their ap_amortised budgets. The true cost stays visible on the
-- Mortgage Interest expense line; principal paydown shows up as the Choices loan
-- balances falling (net worth) — i.e. as equity, not spend.
--
-- Idempotent: sets absolute values, categories looked up by name.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  part_ids uuid[];
begin
  select array_agg(id) into part_ids
  from categories
  where household_id = hh
    and name in ('Mortgage Part 1', 'Mortgage Part 2', 'Mortgage Part 3');

  update categories
    set kind = 'transfer'
    where household_id = hh and id = any(part_ids);

  update budgets
    set active = false
    where household_id = hh and category_id = any(part_ids);
end $$;
