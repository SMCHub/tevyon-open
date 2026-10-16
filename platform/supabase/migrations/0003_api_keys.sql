-- API keys for agents (MCP) and the CLI, sent as "Authorization: Bearer tch_…".
-- Only the SHA-256 of a key is stored; the key itself is shown once when it is issued.
-- Server-only like 0001: RLS is on and there are no policies, so the Data API exposes nothing.

create table api_keys (
  id uuid primary key,
  account_id uuid not null,
  name text not null check (char_length(name) between 1 and 60),
  prefix text not null,
  key_hash text not null unique,
  email text,
  created_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_account_idx on api_keys (account_id, created_at desc) where revoked_at is null;

alter table api_keys enable row level security;
