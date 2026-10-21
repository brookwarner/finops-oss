-- 0050_emergency_fund_total_spend_months.sql
-- The emergency-fund target is now sized off TOTAL monthly spend (all spendable
-- categories, discretionary as well as essential) rather than an essentials-only
-- floor — see src/lib/buffer/compute.ts. With a broader base, the default cushion
-- moves from 3 to 4 months so the headline target reflects "a few months of life
-- as actually lived". Also re-anchor any already-designated fund to 4 months
-- (it was set under the old essentials-only basis).
alter table accounts
  alter column emergency_fund_target_months set default 4;

update accounts
  set emergency_fund_target_months = 4
  where is_emergency_fund
    and emergency_fund_target_months = 3;
