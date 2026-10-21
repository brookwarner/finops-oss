-- RLS for the M5 data-layer tables, matching the per-table household pattern
-- used by accounts/transactions/categories (read policy for members; writes are
-- performed by the nightly cron via the service-role key, which bypasses RLS).
-- Without this, the future Investments page / trend chart reading these tables
-- with the anon key would leak rows across households once a second household
-- joins. Latent today (single-user), fixed now to match convention.

alter table holdings enable row level security;
alter table net_worth_snapshots enable row level security;

create policy "members can read holdings in their household"
  on holdings for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = holdings.household_id and hm.user_id = auth.uid()
    )
  );

create policy "members can read net worth snapshots in their household"
  on net_worth_snapshots for select
  using (
    exists (
      select 1 from household_members hm
      where hm.household_id = net_worth_snapshots.household_id and hm.user_id = auth.uid()
    )
  );
