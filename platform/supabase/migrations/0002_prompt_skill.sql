-- Every generation runs through the prompt skill of its model (src/core/prompting.ts).
-- provider_params: the parameters actually sent to the model (prompt written by the skill). Server-only, never in a job view.
-- prompt_skill: name@version of the skill that wrote it, so every result can be traced and reproduced.
alter table jobs add column provider_params jsonb;
alter table jobs add column prompt_skill text;
