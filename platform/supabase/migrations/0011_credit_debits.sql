-- Credits that leave an account outside of a job. Server-only, like the rest of the credit tables.
-- director: a message with one of the strongest models, held at its cap while the turn runs, then settled to what the
--           turn really cost (the rest goes back) or void if the turn never began.
-- refund / dispute: the credits of a purchase whose payment was refunded or disputed. Taken from what is available;
--           the rest stays owed and is paid from the next grants first. A dispute that is won is void again.
create table credit_debits (
  ref text primary key,
  account_id uuid not null,
  kind text not null check (kind in ('director', 'refund', 'dispute')),
  state text not null check (state in ('held', 'settled', 'void')),
  -- What is due, and how much of it has been taken from the balance so far (owed = credits - collected).
  credits integer not null check (credits > 0),
  collected integer not null default 0 check (collected >= 0 and collected <= credits),
  -- director: the public model name for the statement.
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index credit_debits_account_idx on credit_debits (account_id, created_at);
create index credit_debits_owed_idx on credit_debits (account_id, created_at) where state = 'settled' and collected < credits;

-- The payment behind a purchase: refunds and disputes only name the PaymentIntent, never the Checkout Session.
alter table credit_grants add column payment_intent text unique;
alter table credit_grants add column amount_rappen integer check (amount_rappen > 0);

-- Director turns paid with credits do not use up the free daily budget.
alter table director_usage add column credits integer not null default 0 check (credits >= 0);

alter table credit_debits enable row level security;
