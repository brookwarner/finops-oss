-- 0038_alerts_add_reserve_sweep.sql
-- Add a 'reserve_sweep' alert type: a cycle-close nudge to physically move the
-- spare surplus into the designated reserve buffer account. Deduped per cycle on
-- (type, period_start).
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in (
  'cap_breach','cap_warning','cap_ok','reserve_withdrawal','flex_digest',
  'subscription_new','subscription_duplicate','monthly_review','budget_coverage_gap',
  'reserve_sweep'
));
