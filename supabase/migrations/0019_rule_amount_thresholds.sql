-- Amount-gated category rules.
--
-- Some merchants are inherently ambiguous and only resolve by spend size — the
-- canonical case is petrol stations: a $9 BP is food (a pie + coffee at the
-- counter), an $85 BP is a tank of fuel. The text-only rule engine can't tell
-- them apart, so it forces every BP into one category.
--
-- These nullable columns add an optional absolute-amount gate to a rule,
-- interpreted as a half-open window [min_amount, max_amount) over abs(amount):
--   * min_amount = 20            -> fires only when |amount| >= 20
--   * max_amount = 20            -> fires only when |amount| <  20
--   * both null (default)        -> no gate; rule matches on text alone (unchanged)
-- See src/lib/categorise/engine.ts (amountGateOk).

alter table category_rules
  add column if not exists min_amount numeric,
  add column if not exists max_amount numeric;

comment on column category_rules.min_amount is
  'Optional inclusive lower bound on abs(transaction amount) for this rule to apply. Null = unbounded.';
comment on column category_rules.max_amount is
  'Optional exclusive upper bound on abs(transaction amount) for this rule to apply. Null = unbounded.';
