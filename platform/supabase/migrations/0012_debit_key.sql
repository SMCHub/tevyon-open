-- A Director message paid through an API key or OAuth connection counts against that key's daily limit, like a job.
alter table credit_debits add column api_key_id uuid;

create index credit_debits_key_idx on credit_debits (api_key_id, created_at) where api_key_id is not null;
