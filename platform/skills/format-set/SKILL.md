---
name: format-set
version: 1.0.3
kind: workflow
description: >-
  One motif in several formats for one campaign: feed (1:1), story or reel (9:16), web and video (16:9).
  Use when the user wants the same image or clip for several channels.
  Trigger: "for all channels", "in every format", "1:1 and 9:16", "story and feed", "format set", "campaign set".
---

# Format set

Same motif, several formats, one consistent look. The trick is a prompt that works in every format, written once and
reused for every format with `basedOn`, so all versions share the same written prompt.

## Steps

1. **Ask for the channels** if the user did not name them, and map them to formats:
   feed → 1:1 (images), story / reel / short → 9:16, website / YouTube / presentation → 16:9, banner → 21:9 (images).
2. **Check the model's formats** in `GET /api/catalog`. Videos: Veo 3.1 Lite has 16:9 and 9:16, Kling 3.0 adds 1:1,
   Wan 2.7 adds 1:1, 4:3 and 3:4. Images: Seedream and FLUX.2 cover all formats above.
3. **Write one prompt for all formats.** Put the subject in the middle with space around it, so every format can
   frame it: "centred subject with generous space on all sides". No format words in the prompt ("wide", "vertical",
   "panorama"): the format is a setting. Text in the image short and central, because the edges differ by format.
4. **Price the whole set.** One `POST /api/quote` per format; show the user the total before anything starts.
5. **Start the first format** (the most important channel) with `POST /api/jobs/{job_type}`, and keep its job id.
6. **Start the other formats** with the same job type, the same prompt words, only `aspect_ratio` changed, and
   `"basedOn": "<id of the first job>"`. The server reuses the first job's written prompt for all of them.
7. **Collect** with `GET /api/jobs` and hand the user the set, named by channel.

## Rules

- For videos, combine with draft-to-final: draft the most important format first, then the finals of all formats
  based on that draft.
- If one format fails or is moderated, the others are unaffected; the failed one costs nothing. Retry only that one.
- Keep the whole set on one model. Different models give different looks.
