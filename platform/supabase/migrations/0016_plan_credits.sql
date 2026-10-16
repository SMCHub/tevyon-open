-- Plan credits (Abo) expire with their period; bought and welcome credits never do.
-- A plan grant keeps what is left of it. Every spending path takes plan credits first, earliest expiry first; what is
-- left at expires_at lapses and never changes again (credits that go back after the end come back as normal credits).
-- credit_accounts.balance keeps counting a lapsed remainder: available = balance - sum(remaining) of the ended grants.
alter table credit_grants add column expires_at timestamptz;
alter table credit_grants add column remaining integer;
alter table credit_grants add constraint credit_grants_plan_check
  check ((expires_at is null and remaining is null) or (expires_at is not null and remaining >= 0 and remaining <= credits));

create index credit_grants_plan_idx on credit_grants (account_id, expires_at) where remaining > 0;

-- Which plan grant paid how much of a job (owner = job id) or a debit (owner = debit ref), so credits that go back
-- return to the plan they came from while it runs.
create table credit_uses (
  owner text not null,
  grant_ref text not null references credit_grants (ref),
  credits integer not null check (credits > 0),
  primary key (owner, grant_ref)
);

alter table credit_uses enable row level security;

-- Monthly plans as Stripe reports them (customer.subscription.*). The credits of a month come from its paid invoice
-- (grant ref sub:<invoice>); this row says which plan an account has, until when, and its Stripe customer for the portal.
-- event_at: when Stripe sent the state. Events arrive out of order; an older state never overwrites a newer one.
create table subscriptions (
  id text primary key,
  account_id uuid not null,
  customer_id text not null,
  plan_id text not null,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_account_idx on subscriptions (account_id, event_at desc);

alter table subscriptions enable row level security;
