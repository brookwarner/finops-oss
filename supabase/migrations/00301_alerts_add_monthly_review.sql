-- Add `monthly_review` to the alerts type check-constraint.
--
-- Background: the monthly-review agent (`POST /api/agent-report`) persists a
-- `monthly_review` alert row, but its constraint migration was deferred. In the
-- meantime `0029` re-defined `alerts_type_check` to add the subscription types.
-- This migration redefines the constraint as the FULL superset so the agent
-- endpoint can insert without violating the check. Keep this list authoritative:
-- any future alert type must be added here.

alter table alerts drop constraint alerts_type_check;
alter table alerts add constraint alerts_type_check check (type in (
  'cap_breach',
  'cap_warning',
  'cap_ok',
  'reserve_withdrawal',
  'flex_digest',
  'subscription_new',
  'subscription_duplicate',
  'monthly_review'
));
