---
name: prompt-image-tools
version: 1.0.0
kind: prompt
models: [cutout, upscale, relight, replace_background]
max_chars: 500
min_words: 1
negations: ok
slots: [setting, light, note]
description: >-
  The image tools: Cutout (removes the background, PNG with transparency), Upscale (sharper and larger, 2x or 4x),
  Relight (new light from a fixed list) and Replace Background (keeps the subject, describes a new setting). Cutout,
  Upscale and Relight need no prompt; Replace Background needs a short description of the new background.
  Trigger: remove background, cut out, transparent PNG, upscale, enhance, sharpen, higher resolution, relight,
  new light, replace background, new setting.
---

# Image tools skill

Four tools with one fixed task each, all on one of the user's own pictures (`image`). [I] = inference, not documented.

## Cutout (`cutout`)

- Result: the same picture with the background removed, as PNG with an alpha channel, at the original size.
- Works best when one subject stands out (a person, a product, an animal). A subject that blends into its
  background may lose an edge or keep a piece of it.
- No prompt: send an empty one.

## Upscale (`upscale`)

- `scale`: `"2x"` (default) or `"4x"`. Result: the picture sharper and larger, at most 8192 px a side.
- It sharpens what is there and does not invent new content; a cut-out stays transparent.
- No prompt: send an empty one.

## Relight (`relight`)

- `light`: one of the offered light types (midday, blue hour, sunrise, overcast, moonlight …); `direction`: front,
  side, bottom or top-down. The picture keeps its content, only the light changes.
- No prompt: the settings say everything.

## Replace Background (`replace_background`)

The subject stays exactly as it is; the prompt describes only the new background, in one or two English sentences:
place, surface, light and mood, matching the subject's perspective [I].

- `A sunlit white marble kitchen counter, soft morning light from a window on the left, a blurred green plant behind.`
- `A deep blue seamless studio backdrop with a soft spotlight behind the product.`
- A plain colour works too: `a flat #F5F5F2 background`.

Do not describe the subject or ask for changes to it: it is cut out and kept as it is.
