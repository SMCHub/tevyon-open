-- Marketing Agent library per account: saved products, ad references and favourite results, so they follow the
-- account to every device (before: localStorage only). One row per item; data is checked by core/marketing-library.ts.
create table marketing_items (
  account_id uuid not null,
  kind text not null check (kind in ('product', 'reference', 'favorite')),
  id text not null check (char_length(id) between 1 and 64),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, kind, id)
);

create index marketing_items_account_idx on marketing_items (account_id, kind, updated_at desc);

alter table marketing_items enable row level security;
