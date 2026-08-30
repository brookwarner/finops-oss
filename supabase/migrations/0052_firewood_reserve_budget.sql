-- Add a "Firewood" reserve budget. Firewood is a lumpy seasonal (winter)
-- purchase, not a monthly recurring bill, so it gets a reserve (sinking-fund)
-- budget like Home Maintenance / Home Improvement rather than a monthly cap.
--
-- $800/yr annualised to a monthly accrual target: 800 / 12 = 66.67/mo.
--
-- Idempotent; household-guarded; no-ops on a fresh / OSS DB.
do $$
declare
  hh uuid := '00000000-0000-0000-0000-000000000001';
  cat_id uuid;
begin
  if not exists (select 1 from households where id = hh) then return; end if;

  insert into categories (household_id, name, "group", kind, context)
  values (hh, 'Firewood', 'Maintenance', 'reserve', 'personal')
  on conflict (household_id, name) do update
    set "group" = excluded."group",
        kind    = excluded.kind,
        context = excluded.context
  returning id into cat_id;

  insert into budgets (household_id, category_id, kind, monthly_target, active)
  values (hh, cat_id, 'reserve', 66.67, true)
  on conflict (household_id, category_id) do update
    set kind           = excluded.kind,
        monthly_target = excluded.monthly_target,
        active         = true;
end $$;
