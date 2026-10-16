-- Which channel started a job (Studio, MCP, CLI, other API clients) and with which API key.
-- The statement shows the channel per job; spend per key becomes visible for the key owner.
-- Existing jobs all came from the Studio, hence the default.
alter table jobs add column origin text not null default 'web' check (origin in ('web', 'mcp', 'cli', 'api'));
alter table jobs add column api_key_id uuid;

create index jobs_api_key_idx on jobs (api_key_id, created_at desc) where api_key_id is not null;
