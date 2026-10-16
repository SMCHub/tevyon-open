-- Worker claim (src/core/jobs.ts): one worker at a time advances a job, however many processes run a worker and
-- however often a queue delivers the same job. A worker claims the jobs it is about to advance until lease_until and
-- renews the claim while a vendor call is still running; others skip claimed jobs. When a worker stops, its claim
-- runs out and any worker takes the job over. Server-only like provider_handle.
alter table jobs add column lease_owner text;
alter table jobs add column lease_until timestamptz;
