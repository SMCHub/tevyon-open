-- What each Director turn really cost at the language model (usage.cost), per account and text model.
-- Server-only like jobs.cost_usd: the daily Director budget is checked against it, prices never reach a client.
create table director_usage (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  model_id text not null,
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null
);

create index director_usage_account_idx on director_usage (account_id, created_at desc);

alter table director_usage enable row level security;
