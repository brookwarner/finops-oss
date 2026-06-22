-- 0042 — income classification (salary vs not).
--
-- Income detection is by category (kind='income'). This adds a per-source TYPE so
-- the app can tell *salaried/recurring* income (which the forecast may project
-- forward as future pay, and whose presence means "still earning a wage") apart
-- from *irregular / one-off* income (a redundancy payout, a receivership lump, a
-- one-time bonus) that must NOT be assumed to repeat.
--
--   salary    — regular employment wage (recurring; its absence ⇒ runway mode)
--   recurring — other dependable income (partner income, interest, rent)
--   irregular — sporadic, unpredictable income (occasional freelance)
--   one_off   — lands once, never repeats (payout, gift, lump)
--
-- Nullable; code treats NULL as 'recurring' (back-compat with today's behaviour,
-- where every income stream is eligible to be projected forward).
alter table categories add column if not exists income_type text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'categories_income_type_check'
  ) then
    alter table categories
      add constraint categories_income_type_check
      check (income_type is null or income_type in ('salary','recurring','irregular','one_off'));
  end if;
end $$;

-- Seed the owner's existing income sources with sensible defaults (only where unset).
update categories set income_type = 'salary'
  where kind = 'income' and name = 'Salary' and income_type is null;

update categories set income_type = 'recurring'
  where kind = 'income'
    and name in ('Partner ECE Income', 'Interest Income', 'Business Income')
    and income_type is null;

update categories set income_type = 'irregular'
  where kind = 'income' and name = 'Other Income' and income_type is null;
