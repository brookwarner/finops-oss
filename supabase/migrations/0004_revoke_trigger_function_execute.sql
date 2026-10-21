-- Trigger functions are SECURITY DEFINER but should only run via triggers,
-- not be callable as RPCs by anon/authenticated. Revoke EXECUTE.
revoke execute on function public.bootstrap_household_for_user() from anon, authenticated, public;
revoke execute on function public.seed_default_categories() from anon, authenticated, public;
