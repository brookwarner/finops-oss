-- Rename: kind value 'sinking_fund' -> 'reserve' across categories + budgets.
-- "Sinking fund" reads as depleting; "reserve" matches the actual semantics
-- (accumulating buffer drawn down for lumpy spend).
alter table categories drop constraint categories_kind_check;
update categories set kind = 'reserve' where kind = 'sinking_fund';
alter table categories add constraint categories_kind_check
  check (kind in ('monthly_cap','reserve','ap_amortised','income','transfer','business_subsidy','system'));

alter table budgets drop constraint budgets_kind_check;
update budgets set kind = 'reserve' where kind = 'sinking_fund';
alter table budgets add constraint budgets_kind_check
  check (kind in ('monthly_cap','reserve','ap_amortised'));

-- Guarded so this migration replays cleanly from scratch: 0013 already creates
-- the column as `reserve_balance`, so on a fresh DB there is nothing to rename.
-- On the original prod DB the column was `sinking_balance` here and gets renamed.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'budgets' and column_name = 'sinking_balance') then
    alter table budgets rename column sinking_balance to reserve_balance;
  end if;
end $$;
