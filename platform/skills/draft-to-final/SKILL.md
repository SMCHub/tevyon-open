---
name: draft-to-final
version: 1.0.4
kind: workflow
description: >-
  Cheap draft first, then the final with exactly the same prompt and better settings.
  Use for every video and for images the user wants to judge before paying for the final quality.
  Trigger: "make a video", "preview first", "draft", "test first", "final", any job that costs more than a few
  credits.
---

# Draft → final

Tevyon's core habit: nobody pays the full price for a guess. A short, low-resolution draft shows whether the idea
works; the final then uses **the same written prompt** with the expensive settings. Only the settings change, so the
final looks like the draft, only better.

## Steps

1. **Pick the model.** `GET /api/catalog` lists every model with its settings. Choose by the user's goal; the
   catalog line of each model says what it is good at.
2. **Write or pass the prompt.** Either pass the user's own words and let the server write the prompt for the model
   (`promptMode: "auto"`), or pass a finished prompt of your own (`promptMode: "exact"`). The prompt words stay fixed
   from here on.
3. **Price both steps first.** Call `POST /api/quote` twice: once with the draft settings, once with the final
   settings. Show the user both prices and the prompt hints (`prompt.notes`) before anything starts.
4. **Start the draft.** `POST /api/jobs/{job_type}` with `{ "params": {…draft settings}, "promptMode": … }` and an
   `Idempotency-Key` header. Keep the returned job id.
5. **Wait for it.** Poll `GET /api/jobs` until the job is `succeeded` or `failed`. A failed or moderated draft costs
   nothing; rephrase before trying again, never resend a moderated prompt unchanged.
6. **Let the user decide.** Final as it is, or change the words (that is a new draft), or stop.
7. **Start the final** with the same job type (or another model of the same prompt skill, e.g. Seedream 5 Flash →
   Seedream 4.5), **the same prompt words**, the final settings and `"basedOn": "<draft job id>"`. The server then
   reuses the draft's written prompt instead of writing a new one. Changed words are written anew; then it is not
   the same picture any more, say so.

## Draft settings per model

| Model | Draft | Final |
|---|---|---|
| Veo 3.1 Lite | 4 s, 720p, sound as in the final | 6–8 s, 1080p only with 8 s |
| Kling 3.0 | 3 s, sound as in the final | the length the story needs (up to 15 s) |
| Wan 2.7 | 3 s, 720p | up to 10 s, 1080p |
| Seedream 4.5 | 2K, two to four variants as separate jobs | 4K of the chosen variant |
| FLUX.2 Pro | two to four variants as separate jobs | none needed: FLUX.2 has no resolution setting, the chosen variant is the final |

The prices come from `POST /api/quote`, never from memory: they change with the models.

## Rules

- Never start the final before the user has seen the draft and the final price.
- Keep everything that is not a setting identical between draft and final: prompt words, prompt mode, model family.
- Keep the sound setting the same in draft and final. The written prompt directs the sound only when sound is on; a
  draft without sound gives a final whose prompt has no dialogue or sound direction. Save on length and resolution.
- Several drafts are fine; build the final on the one the user picked.
- For a sequence of clips (a story in several shots), run draft → final per shot and keep a written description of
  each character that you repeat word for word in every shot.
