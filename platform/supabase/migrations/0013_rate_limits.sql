-- Rate limits for open endpoints (OAuth client registration, device login start): one fixed-window counter per
-- bucket, e.g. "oauth.register:addr:203.0.113.7". Counted with one upsert, so the limit holds across server instances.
-- Server-only like 0001: RLS on, no policies.
create table rate_limits (
  bucket text primary key,
  count integer not null,
  reset_at timestamptz not null
);
create index rate_limits_reset_idx on rate_limits (reset_at);
alter table rate_limits enable row level security;

-- When a dynamically registered client first got an authorization code. Clients that never did are removed by the
-- cleanup cron after a week; clients behind a connection count as used.
alter table oauth_clients add column used_at timestamptz;
update oauth_clients c set used_at = c.created_at where exists (select 1 from api_keys k where k.client_id = c.id);
