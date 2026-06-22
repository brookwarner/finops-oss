-- Annualised growth: give each holding an inception so we can turn the
-- cumulative since-purchase return into a per-year (CAGR) rate.
-- ----------------------------------------------------------------------------
-- Two date sources, by design (see src/lib/holdings/annualise.ts):
--
--  * holdings.first_seen — stamped automatically the FIRST time the nightly sync
--    upserts a fund, then never overwritten (it is deliberately left OUT of the
--    cron upsert payload so ON CONFLICT DO UPDATE never touches it). For funds
--    bought AFTER this migration ships this is the true purchase date, so new
--    holdings annualise hands-off. For funds that predate tracking it is just
--    the backfill date (today), which is why we also have…
--
--  * accounts.investment_inception_date — an optional, manually-set "investing
--    since" date per account. It overrides first_seen for that account's
--    original holdings (the back-catalogue we never observed being bought).
--
-- Effective inception = manual override ?? earliest first_seen in the account;
-- a fund whose first_seen is clearly later than that earliest is treated as a
-- genuinely-new purchase and uses its own first_seen.

alter table holdings
  add column first_seen date not null default current_date,
  -- true once we actually WATCHED a fund appear (default for all rows inserted
  -- from now on); false for the rows backfilled by this migration, whose
  -- first_seen is just today and must not be trusted as a purchase date.
  add column first_seen_observed boolean not null default true;

-- Existing holdings predate observation — their first_seen is a backfill, so
-- annualisation must rely on the manual investing-since date below, not this.
update holdings set first_seen_observed = false;

alter table accounts
  add column investment_inception_date date;

comment on column holdings.first_seen is
  'Date this fund was first observed by the nightly sync (auto, never updated). True purchase date for funds first seen after 0037; backfill date for older ones.';
comment on column holdings.first_seen_observed is
  'False for rows backfilled by 0037 (first_seen unreliable); true for funds whose arrival we actually observed (first_seen is the real purchase date).';
comment on column accounts.investment_inception_date is
  'Optional manual "investing since" date. Seeds annualised-return CAGR for holdings that predate first_seen observation.';
