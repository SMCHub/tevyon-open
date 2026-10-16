-- Webhooks for jobs started over the API or MCP: when a job has finished (succeeded or failed), Tevyon posts it once
-- to the caller's https address, signed with the account's webhook secret, and retries a few times on failure
-- (core/webhooks.ts). Its own table, so the jobs table and its repository stay as they are.
create table job_webhooks (
  job_id uuid primary key,
  account_id uuid not null,
  url text not null,
  -- The origin the job was started at; links in the payload point there.
  base text not null,
  created_at timestamptz not null,
  attempts int not null default 0,
  next_at timestamptz not null,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_status int
);

create index job_webhooks_due_idx on job_webhooks (next_at) where delivered_at is null and failed_at is null;

alter table job_webhooks enable row level security;
