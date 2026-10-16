-- Jobs and credits. Only the server (secret key / direct connection) touches these tables:
-- RLS is on and there are no policies, so the Data API exposes nothing.
-- provider_handle and provider_detail are server-only and must never reach a client.

create table credit_accounts (
  account_id uuid primary key,
  balance integer not null default 0 check (balance >= 0)
);

create table credit_grants (
  ref text primary key,
  account_id uuid not null,
  credits integer not null check (credits > 0),
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key,
  account_id uuid not null,
  job_type text not null,
  model text not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  credits integer not null check (credits >= 0),
  -- Credits in three steps: reserved on insert, settled on success, released in full on failure.
  credit_state text not null default 'reserved' check (credit_state in ('reserved', 'settled', 'released')),
  params jsonb not null,
  outputs jsonb not null default '[]'::jsonb,
  error text check (error in ('content_moderated', 'invalid_request', 'generation_failed', 'timed_out')),
  provider_handle text,
  provider_detail text,
  unreachable integer not null default 0,
  idempotency_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (account_id, idempotency_key)
);

create index jobs_active_idx on jobs (created_at) where status in ('queued', 'running');
create index jobs_account_idx on jobs (account_id, created_at desc);

alter table credit_accounts enable row level security;
alter table credit_grants enable row level security;
alter table jobs enable row level security;
