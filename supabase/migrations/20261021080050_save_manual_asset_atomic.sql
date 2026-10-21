-- Keep the account and its loan/receivable terms in one transaction. Invoker
-- security preserves member RLS; service callers must supply a scoped household.
create function public.save_manual_asset(
  p_household_id uuid, p_asset jsonb, p_create boolean,
  p_loan jsonb default null, p_inflow jsonb default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.accounts;
  account_key text := p_asset->>'akahu_account_id';
begin
  if left(account_key, 7) <> 'manual_' or account_key is null then
    raise exception 'id must be a manual_ asset id';
  end if;
  if nullif(btrim(p_asset->>'name'), '') is null
    or (p_asset->>'type') not in ('other', 'investment', 'savings', 'receivable')
    or (p_asset->>'balance_current') is null
    or (p_asset->>'balance_current') in ('NaN', 'Infinity', '-Infinity') then
    raise exception 'invalid manual asset';
  end if;
  if p_loan is not null then
    if not exists (select 1 from public.categories where household_id = p_household_id
      and id = (p_loan->>'repayment_category_id')::uuid) then
      raise exception 'repayment category not found in this household';
    end if;
    if (p_loan->>'annual_rate')::numeric < 0 or (p_loan->>'anchor_balance')::numeric < 0
      or (p_loan->>'annual_rate') is null or (p_loan->>'anchor_balance') is null
      or (p_loan->>'annual_rate') in ('NaN', 'Infinity', '-Infinity')
      or (p_loan->>'anchor_balance') in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'invalid loan terms';
    end if;
  end if;
  if p_inflow is not null and ((p_asset->>'type') <> 'receivable'
    or (p_inflow->>'tax_rate')::numeric not between 0 and 1
    or (p_inflow->>'tax_rate') is null
    or (p_inflow->>'tax_rate') in ('NaN', 'Infinity', '-Infinity')) then
    raise exception 'invalid receivable terms';
  end if;

  if p_create then
    insert into public.accounts(household_id, akahu_account_id, name, institution,
      type, currency, balance_current, attributes, refreshed_balance_at)
    values (p_household_id, account_key, p_asset->>'name', p_asset->>'institution',
      p_asset->>'type', p_asset->>'currency', (p_asset->>'balance_current')::numeric, '{}', now())
    returning * into saved;
  else
    update public.accounts set name = p_asset->>'name', institution = p_asset->>'institution',
      type = p_asset->>'type', currency = p_asset->>'currency',
      balance_current = (p_asset->>'balance_current')::numeric, refreshed_balance_at = now()
    where household_id = p_household_id and akahu_account_id = account_key
    returning * into saved;
    if not found then raise exception 'manual asset not found in this household'; end if;
  end if;

  if p_loan is not null then
    insert into public.amortising_liabilities(household_id, akahu_account_id,
      anchor_balance, anchor_date, annual_rate, repayment_category_id)
    values (p_household_id, account_key, (p_loan->>'anchor_balance')::numeric,
      (p_loan->>'anchor_date')::date, (p_loan->>'annual_rate')::numeric,
      (p_loan->>'repayment_category_id')::uuid)
    on conflict (akahu_account_id) do update set anchor_balance = excluded.anchor_balance,
      anchor_date = excluded.anchor_date, annual_rate = excluded.annual_rate,
      repayment_category_id = excluded.repayment_category_id
    where amortising_liabilities.household_id = p_household_id;
    if not found then raise exception 'loan belongs to another household'; end if;
  end if;
  if p_inflow is not null then
    insert into public.expected_inflows(household_id, akahu_account_id,
      likelihood, expected_date, pre_tax, tax_rate)
    values (p_household_id, account_key, p_inflow->>'likelihood',
      (p_inflow->>'expected_date')::date, (p_inflow->>'pre_tax')::boolean, (p_inflow->>'tax_rate')::numeric)
    on conflict (akahu_account_id) do update set likelihood = excluded.likelihood,
      expected_date = excluded.expected_date, pre_tax = excluded.pre_tax, tax_rate = excluded.tax_rate
    where expected_inflows.household_id = p_household_id;
    if not found then raise exception 'receivable belongs to another household'; end if;
  end if;
  return to_jsonb(saved) || jsonb_build_object(
    'loan', (select to_jsonb(l) || jsonb_build_object('repayment_category_name', c.name)
      from public.amortising_liabilities l join public.categories c on c.id = l.repayment_category_id
      where l.household_id = p_household_id and l.akahu_account_id = account_key),
    'inflow', (select to_jsonb(i) from public.expected_inflows i
      where i.household_id = p_household_id and i.akahu_account_id = account_key));
end;
$$;
revoke all on function public.save_manual_asset(uuid, jsonb, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.save_manual_asset(uuid, jsonb, boolean, jsonb, jsonb) to authenticated, service_role;
