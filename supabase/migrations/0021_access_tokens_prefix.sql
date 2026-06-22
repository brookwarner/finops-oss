-- Add a display prefix for PATs (raw token shown once at mint time).
alter table access_tokens add column if not exists prefix text;
