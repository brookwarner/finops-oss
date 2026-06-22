-- Widen the rule-dedup unique index to include the amount-gate bounds so a
-- single merchant/pattern can carry two rules that differ only by their
-- [min_amount, max_amount) window — the petrol fuel-vs-food split from
-- migration 0019. NULLS NOT DISTINCT keeps text-only rules (null bounds)
-- deduping exactly as the original 4-column index did.
--
-- Supersedes the 4-column category_rules_dedup_idx from migration 0018 and
-- establishes the canonical name category_rules_dedupe_idx on the 6 columns,
-- which scripts/petrol_amount_rules.sql expects (that script's drop+create of
-- the same index is then idempotent). Without this, the narrow 0018 index
-- would reject the two petrol rows that share (household_id, pattern, BP,
-- description) and differ only by amount bounds.

drop index if exists category_rules_dedup_idx;
drop index if exists category_rules_dedupe_idx;

create unique index category_rules_dedupe_idx
  on public.category_rules (household_id, match_type, match_value, field, min_amount, max_amount)
  nulls not distinct;
