-- Model sync (src/core/model-sync.ts): lifecycle of every job type, the vendor catalog as last read, and the log.
-- Server-only: RLS on, no policies. Vendor model IDs and prices stored here never reach a client.

create table model_sync_state (
  id smallint primary key default 1 check (id = 1),
  -- Optimistic lock: a save based on an older version is refused, so two syncs never overwrite each other.
  version integer not null,
  state jsonb not null,
  report jsonb,
  updated_at timestamptz not null default now()
);

create table model_events (
  id bigserial primary key,
  at timestamptz not null,
  type text not null,
  level text not null check (level in ('info', 'warn', 'action')),
  job_type text,
  vendor_model text,
  message text not null,
  data jsonb
);

create index model_events_at_idx on model_events (at desc, id desc);

alter table model_sync_state enable row level security;
alter table model_events enable row level security;
