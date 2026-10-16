-- OAuth 2.1 for agents (claude.ai connector, Claude Code, Cursor …) and the CLI login (device flow).
-- An OAuth connection is a row of api_keys with kind 'oauth': its tokens hang on that row, so the key list,
-- revocation, the daily limit and the statement treat keys and connections alike.
-- Only hashes of tokens, codes and client secrets are stored. Server-only like 0001: RLS on, no policies.

alter table api_keys add column kind text not null default 'key' check (kind in ('key', 'oauth'));
alter table api_keys add column client_id text;
-- Credits a key or connection may spend per 24 hours; null = no limit. Default decided 13.10.2026 (300).
alter table api_keys add column daily_limit integer default 300 check (daily_limit is null or daily_limit > 0);
alter table api_keys alter column key_hash drop not null;
alter table api_keys add constraint api_keys_hash_for_keys check (kind = 'oauth' or key_hash is not null);
create index api_keys_oauth_idx on api_keys (account_id, client_id) where kind = 'oauth' and revoked_at is null;

-- Clients registered dynamically (RFC 7591). The CLI's own client is built in, not stored.
create table oauth_clients (
  id text primary key,
  secret_hash text,
  name text not null,
  redirect_uris text[] not null,
  grant_types text[] not null,
  auth_method text not null check (auth_method in ('none', 'client_secret_post', 'client_secret_basic')),
  created_at timestamptz not null
);

-- Authorization codes: single use, ten minutes, bound to client, redirect URI and PKCE challenge (S256).
create table oauth_codes (
  code_hash text primary key,
  client_id text not null,
  account_id uuid not null,
  email text,
  redirect_uri text not null,
  code_challenge text not null,
  resource text,
  scope text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Access tokens (one hour) and refresh tokens (30 days, rotated on every use) of a connection.
create table oauth_tokens (
  token_hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  grant_id uuid not null references api_keys (id),
  client_id text not null,
  scope text not null,
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index oauth_tokens_grant_idx on oauth_tokens (grant_id);

-- Device authorizations (RFC 8628) for `tachyon login`: the user confirms the code in the Studio.
create table oauth_devices (
  id uuid primary key,
  code_hash text not null unique,
  user_code text not null unique,
  client_id text not null,
  name text,
  scope text not null,
  interval_s integer not null,
  expires_at timestamptz not null,
  last_poll_at timestamptz,
  status text not null check (status in ('pending', 'approved', 'denied', 'consumed')),
  account_id uuid,
  email text
);

alter table oauth_clients enable row level security;
alter table oauth_codes enable row level security;
alter table oauth_tokens enable row level security;
alter table oauth_devices enable row level security;
