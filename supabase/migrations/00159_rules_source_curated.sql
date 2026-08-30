-- Add 'curated' as a valid value for category_rules.source. Curated rules are
-- hand-maintained against Akahu's canonical merchant.name field, runs ahead
-- of the long-tail bootstrap layer.
alter table category_rules drop constraint category_rules_source_check;
alter table category_rules
  add constraint category_rules_source_check
  check (source in ('manual','llm','bootstrap','curated'));
