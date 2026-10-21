-- 0030's budget_periods.kind CHECK omitted 'income', but budgets.kind allows it
-- (added in 0023 for income-target lines). Snapshotting an income budget therefore
-- violated the constraint. Widen the snapshot CHECK to mirror budgets.kind exactly.

alter table budget_periods drop constraint if exists budget_periods_kind_check;

alter table budget_periods
  add constraint budget_periods_kind_check
  check (kind in ('monthly_cap', 'reserve', 'ap_amortised', 'income'));
