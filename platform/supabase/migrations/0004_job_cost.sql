-- What a finished job really cost us at the provider (ProviderResult.costUsd, e.g. OpenRouter usage.cost).
-- Server-only like provider_handle and provider_detail: it never reaches a client, a job view or a statement.
-- It is the measurement behind the cost model: credits charged against real purchase cost per job type.
alter table jobs add column cost_usd numeric(12, 6) check (cost_usd >= 0);
