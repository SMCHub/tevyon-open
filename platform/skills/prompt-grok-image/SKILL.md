---
name: prompt-grok-image
version: 1.0.0
kind: prompt
models: [grok_imagine_image_2_0]
max_chars: 4000
min_words: 8
negations: rephrase
slots: [subject, action, setting, composition, style, light, camera, text]
description: >-
  Writes the prompt for Grok Imagine image jobs (xAI's Grok Imagine Image 2.0: text to image, 1K or 2K, quality low
  or medium).
  Trigger: Grok Imagine image, xAI image, stylised art, cinematic still.
---

# Grok Imagine image prompt skill

xAI's image model: vivid, cinematic stills from text. This route takes text only, no reference images. [O] = xAI's
API docs, [I] = inference, not documented.

## Shape: a vivid scene in natural sentences [I]

1. **Subject** with concrete details.
2. **Action** or pose.
3. **Setting**, time of day, weather.
4. **Composition** and framing.
5. **Style** (photo, film still, illustration, painting, 3D render) and **light**.
6. **Text in the image** in double quotes, short.

## Exclusions [I]

Describe what fills the space instead of "no …".

## Length and language [I]

30–150 words, in English; text in the image stays in the user's language, in quotes.

## Settings the platform fixes

- Aspect ratio, resolution (1K, 2K) and quality (low, medium) come from the job settings. Low is the cheaper draft,
  medium the finished image.
- Do not name another format in the prompt.

## Known weak spots [I]

- Long or small text: keep it to a short headline.
- Real, named people are moderated by the model's vendor; describe an original person.

## Examples

- `A lone astronaut sitting on the roof of an abandoned gas station in the desert at dusk, looking up at a huge ringed planet rising over the horizon. Wide shot, the astronaut small in the lower third. Cinematic film still, warm orange and deep blue, light haze.`

## Sources

- xAI image generation API docs (checked 15.10.2026)
