-- Consent for jobs that show real people (Face Swap, Character Swap) when an agent starts them over the API, MCP or
-- the CLI: a person signed in to Tevyon confirms that they hold the rights to the images and the consent of everyone
-- shown. A confirmation is bound to the account, the job type and exactly these images, runs out after a while and
-- starts one job. In the Studio the person ticks the box themselves; no grant is needed there.
create table consent_grants (
  id uuid primary key,
  account_id uuid not null,
  job_type text not null,
  images text[] not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  declined_at timestamptz,
  used_at timestamptz,
  job_id uuid
);

create index consent_grants_account_idx on consent_grants (account_id, created_at desc);

alter table consent_grants enable row level security;
