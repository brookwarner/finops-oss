-- Email allowlist for signups. Only emails in this table can create
-- auth.users rows; everyone else is rejected at the database level
-- regardless of what the Supabase Auth dashboard says.
create table public.signup_allowlist (
  email text primary key,
  added_at timestamptz not null default now(),
  note text
);

alter table public.signup_allowlist enable row level security;

insert into public.signup_allowlist (email, note) values
  ('you@example.com', 'primary');

create or replace function public.enforce_signup_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.signup_allowlist
    where lower(email) = lower(new.email)
  ) then
    raise exception 'Signup not permitted for this email' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Run BEFORE the bootstrap trigger so a rejected user never creates a household.
create trigger enforce_signup_allowlist_trigger
  before insert on auth.users
  for each row execute function public.enforce_signup_allowlist();

revoke execute on function public.enforce_signup_allowlist() from anon, authenticated, public;
