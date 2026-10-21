-- Add a 'budget_coverage_gap' alert type: fired when a recurring auto-payment is
-- self-healed into the headline numbers (Position projection + payday forecast)
-- but has no budget row, so it never appears as a visible budget line. The alert
-- nudges adding a real budget row. Fires for exactly the set self-heal acts on.
alter table alerts drop constraint if exists alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in (
  'cap_breach','cap_warning','cap_ok','reserve_withdrawal','flex_digest',
  'subscription_new','subscription_duplicate','monthly_review','budget_coverage_gap'
));
