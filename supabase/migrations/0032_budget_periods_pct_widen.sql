-- 0030 sized pct as numeric(6,2) (max 9999.99). A small-target budget (e.g. a
-- $5 ap_amortised line) easily produces percentages in the tens of thousands,
-- overflowing the column during snapshot. Widen pct to comfortably hold any
-- realistic over-budget percentage.

alter table budget_periods
  alter column pct type numeric(10,2);
