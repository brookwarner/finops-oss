-- Personal Akahu apps don't support webhooks; pending_events was the
-- queue for webhook payloads drained by a 5-min cron. Both gone.
drop table if exists public.pending_events cascade;
