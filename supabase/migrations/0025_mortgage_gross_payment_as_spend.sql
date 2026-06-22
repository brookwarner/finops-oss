-- Model the mortgage as: gross repayment = money out, interest charge = silent.
-- ----------------------------------------------------------------------------
-- Supersedes 0024_mortgage_principal_as_transfer. The mortgage is tracked in
-- CASHFLOW terms: the ~$3,600/mo gross repayment ("Loan repayment" — Mortgage
-- Part 1/2/3) is the real money that leaves the account each month and must show
-- as spend against income. The separate "Mortgage Interest" CHARGE on the loan
-- accounts (~$2,700/mo) is silent internal bookkeeping — it is NOT a separate
-- cash outflow (it's already inside the gross repayment), so it must not be
-- counted (counting both double-counts the interest).
--
-- Therefore:
--   * Mortgage Part 1/2/3 -> ap_amortised expense, budgets re-activated. The
--     ap_amortised gross-leg rule (compute.ts + position.ts) counts the $1,200
--     checking outflow and ignores the +$1,200 loan-credit far leg, so each line
--     shows its gross payment exactly once.
--   * Mortgage Interest -> budget deactivated (silent). Its charge transactions
--     stay categorised but are excluded from spend (position.ts SPEND_EXCLUDED_
--     NAMES + no active budget), so they never hit the headline.
--
-- Net effect: planned spend includes the full $3,600 mortgage payment, excludes
-- the silent interest, and no longer double-counts. Idempotent.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  part_ids uuid[];
  interest_id uuid;
begin
  select array_agg(id) into part_ids
  from categories
  where household_id = hh
    and name in ('Mortgage Part 1', 'Mortgage Part 2', 'Mortgage Part 3');

  -- Principal repayment = real money out.
  update categories set kind = 'ap_amortised'
    where household_id = hh and id = any(part_ids);
  update budgets set active = true
    where household_id = hh and category_id = any(part_ids);

  -- Interest charge = silent; drop it from the counted budget.
  select id into interest_id
  from categories where household_id = hh and name = 'Mortgage Interest';
  update budgets set active = false
    where household_id = hh and category_id = interest_id;
end $$;
