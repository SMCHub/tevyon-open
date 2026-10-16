# Tevyon (open)

An open-source AI image and video studio built on the **Comfy Developer Platform**. One Comfy API key gives you
more than 30 image and video models through the **Comfy Router**: images from FLUX 3, FLUX.2, Seedream 4.5 and 5, GPT Image 2.5,
Nano Banana Pro and 2, Qwen Image 3 Pro and Grok Imagine Image; video from Seedance 2.0 and 2.5, Veo 3.1 (Lite, Fast, full),
Kling 3.0 (Turbo, Standard, Pro) and O1, Wan 2.7 and 3.0, HappyHorse 1.1, Grok Imagine 1.5, FLUX 3 Video, MiniMax H3 and
LTX-2.5; plus **Recast** (keep a clip's motion and camera, swap the scene) and tools (cutout, upscale, relight, replace
background, video upscale, video edit), wrapped in what a paid studio
sells: a price before every job, credits that are reserved, charged on success and refunded in full on failure, a
prompt writer per model, a planning chat (the Director), and an agent layer where Claude, scripts and the CLI can
do anything the web studio can.

Built for Comfy's *Open Source* challenge, October 2026. Licensed under Apache-2.0.

**Demo (56 s):** [docs/demo.mp4](docs/demo.mp4): the studio, the price before every job, a real Recast run, the Director, prompt skills, MCP and the CLI. Voice: ElevenLabs v4 Turbo through the Comfy Router. Music: “Product Launch” by lNPLUSMUSIC (Pixabay Content License). The fashion still and the night-drive clip are the author's own footage, shown as material a user brings in.

## What is in here

| | |
|---|---|
| **Studio** (`platform/`) | Next.js 16 app: image studio, video studio (text or start image), presets, Marketing Agent, image and video tools, Director chat, assets, community, credits. |
| **Job engine** (`platform/src/core/`) | Framework-free, test-driven core: one generic job API (`POST /api/jobs/{job_type}`), a worker with database claims (no job goes to a model twice), credits in three steps, webhooks, consent for real people, AI labels in every file. |
| **Comfy Router provider** (`platform/src/core/providers/comfy.ts`) | Queues jobs at `api.comfy.org/v2/models/{provider}/{model}/requests`, polls to `COMPLETED`, keeps every result file (links or inline base64), maps the router's error buckets to its own codes, and never sends a job twice once it may have been queued. Images go inline in the shape each model wants (data URL, bare base64, Veo bytes, Gemini parts); videos and Bria's images go to **Comfy's asset store** first and reach the router as signed links. A contract test checks every offered setting against the router's own request schemas. |
| **Register** (`platform/src/core/catalog.ts`) | One entry per model: public name, parameter schema (zod), price formula in Comfy credits, router id. Adding a model is one entry plus a prompt skill. |
| **Prompt skills** (`platform/skills/`) | One `SKILL.md` per model family. The server writes each prompt with the model's skill before the job goes out (`prompt_mode: "auto"`), or takes yours as is (`"exact"`). |
| **MCP server** (`/api/mcp`) | Streamable HTTP with OAuth 2.1 (PKCE, dynamic client registration, device flow): `list_models`, `get_price`, `generate`, `get_job`, `ask_director` and more. Every paid call carries the price the user saw (`max_credits`) and an idempotency key. |
| **CLI** (`cli/`) | `tevyon` speaks only the public HTTP API: list models, price, generate, wait, download. |

## Run it locally (5 minutes)

You need Node.js 22.18+ and a key from [platform.comfy.org](https://platform.comfy.org) → **API Keys** (with some
credits: an image costs about 12–30 Comfy credits, a 6 s video about 40–240).

```bash
git clone https://github.com/SMCHub/tevyon-open.git
cd tevyon-open/platform
npm install
cp .env.example .env.local      # put your COMFY_API_KEY in it
npm run dev                     # http://localhost:3100
```

Without Supabase settings the app runs in **local mode**: you are one local account with 2,000 bookkeeping credits
(`LOCAL_CREDITS`), jobs live in memory and files in `.data/media`. Comfy bills the real cost of each job to your key.
Local mode switches itself off in production and as soon as a Supabase project is configured.

Tests: `npm test` (900+ tests, no network, no key needed) and `npm run typecheck`.

### Use it from Claude or the terminal

```bash
# Claude Code: the studio as tools (sign in once in the browser)
claude mcp add --transport http tevyon http://localhost:3100/api/mcp

# CLI (Node runs the TypeScript directly; key from Studio → account menu → API & MCP)
cd ../cli && node bin/tevyon.ts login
node bin/tevyon.ts models
node bin/tevyon.ts generate flux_3_image "a red fox in fresh snow at dawn" --resolution 1k --yes --wait
```

API keys for scripts: Studio → account menu → *API & MCP*.

### Production

Set the Supabase variables (auth with e-mail codes, Postgres, storage) and apply the migrations with
`node --env-file=.env.local scripts/migrate.ts`. Optional: Stripe for credit packs and plans, Resend for mail,
`CRON_SECRET` for the daily cleanup. See `platform/.env.example`.

## How a job runs

1. **Price first.** `POST /api/quote` (or MCP `get_price`) computes the credits from the register, e.g. FLUX 3 at 1K
   = 14.48 Comfy credits → 15 credits. The start carries that number as `maxCredits`; a higher price starts nothing.
2. **Reserve.** The job is stored as `queued` and its credits are held, atomically with the balance check.
3. **Write the prompt.** The worker applies the model's prompt skill with a small language model on the router's chat
   route (Claude Haiku by default), then sends the job to the Comfy Router.
4. **Settle.** On success the result files go into your own media store, the credits are charged, a webhook fires.
   On failure, moderation or a result without files, every credit goes back. All steps are idempotent per job id.

## Presets, Marketing Agent and tools

Three layers on top of the same job API; each one only composes jobs of the register, so prices, credits, refunds and
prompt skills work as for any job.

- **Presets** (`/presets`, `src/core/recipes.ts`): one photo, one click, a finished clip. A recipe fixes model,
  format, length, sound and a prompt written to the model's prompt skill (checked in `preset-skills.test.ts`); the
  user adds a photo and a short wish or the line the clip speaks. Recipe prompts stay on the server: a preset job
  shows its preset, never the prompt. `GET /api/presets` lists them with the price of one run,
  `POST /api/presets/{id}` starts one; MCP: `list_presets`, `run_preset`. The Director proposes them too.
- **Marketing Agent** (`/marketing`, `src/core/marketing.ts`): a product photo becomes UGC, product shots, motion,
  ads, posters or shop images, in styles and templates with fixed formats and lengths. UGC runs in two steps (a
  still of the person with the product, then the still speaks). The agent (`src/core/marketing-agent.ts`) plans a
  small campaign from a brief through the Director's turn, with captions and prices; it never starts a job.
  Saved products, ad references, favourites and projects live in `marketing_items` (migrations 0014 and 0015).
  API: `GET/POST /api/marketing`, `/api/marketing/{quote,ugc,agent,product-link,library}`; MCP:
  `list_marketing_styles`, `run_marketing_style`, `continue_marketing_ugc`, `ask_marketing_agent`.
- **Tools** (`/image/tools`, `/video/tools`): cutout and upscale for images, edit and upscale for your own video.
  The pages and the menus offer a tool only while its job type is in the register.
- **Workflow skills** (`skills/draft-to-final`, `skills/format-set`): how an agent runs a cheap draft before the final,
  and one motif in several formats, over the public job API.
- **Motion library** (`src/core/motion-library.ts`, `/api/motion-library`): ready-made Recast templates; the list
  (`src/core/data/motion-library.json`) is empty until templates exist.

## How the models are checked

- **Real runs through the Comfy Router:** FLUX 3, Veo 3.1 Lite, Seedance 2.5, Recast (Seedance 2.0 Fast) and the
  language models of the Director; these are the results in the demo.
- **Every model, without spending a credit:** `src/core/router-contract.test.ts` sends every offered setting (with and
  without start, end and reference images) through the real provider code and validates the body against the request
  schema the router enforces (`docs.comfy.org/router-schemas`, copied to `src/core/data/router-schemas/` by
  `node scripts/router-schemas.ts`). The other models are checked this way only; their first real run is yours.

## Adding a model

Pick a model from `GET https://api.comfy.org/v2/models`, read its input schema at
`/v2/models/{provider}/{model}/openapi.json` and its price in the Comfy docs, then add an entry to `catalog.ts`:

```ts
jobType({
  jobType: "my_model",
  kind: "image",
  model: "My Model",
  tagline: "Maker · what it is good at",
  params: z.object({ prompt, aspect_ratio: z.enum(["1:1", "16:9"]).default("1:1") }),
  credits: () => creditsFromComfy(20),            // Comfy credits per image
  route: { provider: "comfy", providerModel: "maker/my-model" },
}),
```

and a skill in `skills/prompt-<family>/SKILL.md` whose `models:` lists `my_model`. The server refuses to start while a
job type has no prompt skill.

## Credits and pricing

A job's credits are its Comfy credits × `CREDIT_MARKUP` (default 1), rounded up. Run it for yourself at cost, or set a
markup and Stripe packs to run it for others. Language-model messages in the Director are priced the same way
(`USD_PER_COMFY_CREDIT`, default 1/211 as listed on the Comfy billing page).

## License

Apache-2.0, see `LICENSE` and `NOTICE`. The name «Tevyon» and its logo are not part of the license. Model names
belong to their makers.
