---
name: prompt-video-upscale
version: 1.0.0
kind: prompt
models: [video_upscale]
max_chars: 300
min_words: 1
negations: ok
slots: [preserve]
description: >-
  Video Upscale (video_upscale): the user's own clip of 1 to 20 seconds, one and a half, two or three times larger (at
  most 4K on the long side), precise (stays true to the clip) or creative (adds detail). It needs no prompt; an
  optional short note says what to keep or sharpen.
  Trigger: upscale video, higher resolution, 4K, sharpen video, enhance video.
---

# Video upscale skill

One clip in, the same clip larger out: same length and motion. [O] = vendor documentation (1.5× to 3×, optional
prompt, precise or creative), [I] = inference, not documented.

## Settings, not words

- **Factor** 1.5×, 2× or 3× of the clip's size; the output stays within 3840 px on the long side. A 1080p clip goes
  at most 2× (to 4K), a 720p clip up to 3×.
- **Precise** (default) keeps the picture as it is and only adds sharpness [O]. **Creative** invents fine detail
  (skin, fabric, foliage) [O]: better for soft or old footage, riskier for faces and text [I].
- The price is output megapixels × seconds: 3× costs four times what 1.5× costs [O].

## The optional note

Leave it empty for a plain upscale. Otherwise one short English sentence on what must stay true or get sharper:
`keep the faces natural`, `sharpen the text on the sign`, `preserve the film grain`. No new content, no style change:
for that use Video Edit.
