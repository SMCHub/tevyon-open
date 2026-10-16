-- Community: a public profile per account and the creations their owners publish.
-- Private by default: nothing of an account is public until its owner chose a handle, accepted the community rules and
-- published a creation; each creation can go private again at any time. A publication keeps a snapshot of what others
-- may see of its job, built by core/community.ts from a whitelist (never uploads, never a preset's recipe prompt, never
-- an account id), so the feed reads one table and never a job's own params.
-- Only the server reads and writes these tables: RLS is on, without policies.
create table profiles (
  account_id uuid primary key,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  name text not null check (char_length(name) between 1 and 40),
  bio text not null default '' check (char_length(bio) <= 160),
  -- Default for new publications: show the prompt, so others can take it over.
  show_prompts boolean not null default true,
  -- When the owner accepted the community rules (rights to the content, consent of depicted persons, Nutzungsrichtlinien).
  terms_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- One row per job that was ever published. published_at is null while it is private again. hidden_at is set by
-- moderation (reports or the operator) and keeps it out of the community even if its owner publishes it again;
-- reviewed_at is when the operator last looked at it (reports before that no longer count).
-- No foreign key to jobs: jobs are never deleted. Deleting an account must delete its rows here as well.
create table publications (
  job_id uuid primary key,
  account_id uuid not null,
  kind text not null check (kind in ('image', 'video')),
  show_prompt boolean not null,
  data jsonb not null,
  published_at timestamptz,
  hidden_at timestamptz,
  hidden_reason text check (char_length(hidden_reason) <= 300),
  reviewed_at timestamptz,
  updated_at timestamptz not null
);

create index publications_feed_idx on publications (published_at desc, job_id desc) where published_at is not null and hidden_at is null;
create index publications_account_idx on publications (account_id, published_at desc);

-- Reports from signed-in accounts, one per account and creation. Enough of them hide a creation until the operator
-- looks at it (core/community.ts).
create table publication_reports (
  job_id uuid not null,
  account_id uuid not null,
  reason text not null check (reason in ('rights', 'person', 'sexual', 'violence', 'minors', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null,
  primary key (job_id, account_id)
);

alter table profiles enable row level security;
alter table publications enable row level security;
alter table publication_reports enable row level security;
