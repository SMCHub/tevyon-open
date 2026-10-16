-- Community, second step: avatars, likes, follows, reports about
-- profiles and their moderation (core/community.ts). The community shows counts only, never who liked or follows whom.
-- Only the server reads and writes these tables: RLS is on, without policies.

-- The avatar is one of the owner's uploads (scanned like every upload); the public sees it under
-- /api/community/<handle>/avatar, never the upload path. A profile the operator hides takes its page, its avatar and
-- all its creations out of the community; reviewed_at settles the reports made before it.
alter table profiles add column avatar text check (char_length(avatar) <= 300);
alter table profiles add column hidden_at timestamptz;
alter table profiles add column hidden_reason text check (char_length(hidden_reason) <= 300);
alter table profiles add column reviewed_at timestamptz;

-- Likes: one per account and creation. publications.likes counts them and changes in the same statement as a like.
alter table publications add column likes integer not null default 0 check (likes >= 0);
create table publication_likes (
  job_id uuid not null,
  account_id uuid not null,
  created_at timestamptz not null,
  primary key (job_id, account_id)
);
create index publication_likes_account_idx on publication_likes (account_id, created_at desc);
create index publications_popular_idx on publications (likes desc, published_at desc, job_id desc)
  where published_at is not null and hidden_at is null;

-- Follows between accounts.
create table follows (
  follower_id uuid not null,
  followee_id uuid not null,
  created_at timestamptz not null,
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on follows (followee_id);

-- Reports about a profile (name, handle, bio, avatar), one per reporting account. The operator decides.
create table profile_reports (
  account_id uuid not null,
  reporter_id uuid not null,
  reason text not null check (reason in ('rights', 'person', 'sexual', 'violence', 'minors', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null,
  primary key (account_id, reporter_id)
);

alter table publication_likes enable row level security;
alter table follows enable row level security;
alter table profile_reports enable row level security;
