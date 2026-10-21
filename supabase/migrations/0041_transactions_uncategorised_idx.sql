-- Partial index for the uncategorised-inbox probes.
--
-- Two hot paths filter on `category_id IS NULL AND is_manual_category = false`:
--   1. The app layout's inbox-badge count — runs on EVERY tab navigation
--      (src/app/(app)/layout.tsx), so it sits in the critical path of every
--      page switch.
--   2. The budgets compute's uncategorised count (src/lib/budgets/compute.ts).
--
-- The existing transactions(household_id, occurred_at desc) index range-scans the
-- date window but then has to filter out every already-categorised row. This
-- partial index indexes ONLY the uncategorised, non-manual rows (a small slice of
-- the table), keyed by the same (household_id, occurred_at) the queries order/
-- bound on — so both probes become a tiny index range-scan instead of scanning
-- and discarding the categorised majority.

create index if not exists transactions_uncategorised_idx
  on transactions (household_id, occurred_at desc)
  where category_id is null and is_manual_category = false;
