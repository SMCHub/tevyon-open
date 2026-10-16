-- Starts the server turned away before a job existed (a changed price, a paused model, missing credits …), counted per
-- day, job type, channel and error code for the operator overview (/operations, core/operations.ts). Counts only: no
-- account, no parameters. Older than 90 days they go in the cleanup cron.
create table start_refusals (
  day date not null,
  job_type text not null,
  origin text not null,
  error text not null,
  count int not null default 0,
  primary key (day, job_type, origin, error)
);

alter table start_refusals enable row level security;
