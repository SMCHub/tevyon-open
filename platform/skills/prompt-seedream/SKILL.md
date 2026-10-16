---
name: prompt-seedream
version: 1.0.0
kind: prompt
models: [seedream_4_5, seedream_5_0_pro, seedream_5_0_flash]
max_chars: 3000
min_words: 6
negations: ok
slots: [subject, action, setting, style, color, light, composition, text, purpose]
description: >-
  Writes the prompt for Seedream images (Seedream 4.5 in 2K or 4K, Seedream 5 Pro and Seedream 5 Flash in 1K or 2K; edits with reference images).
  Trigger: Seedream, posters, typography, product images, infographics, image sets, edits with references.
---

# Seedream prompt skill

ByteDance's image models: photoreal and illustrated, strong at legible text, posters, layouts and consistent image
sets. [O] = ByteDance's own prompt guide, [I] = inference, not documented.

## Shape: natural sentences, in this order [O]

1. **Subject + action + environment**: who or what, doing what, where.
2. **Style, colour, light, composition**, as needed: precise style words ("picture book style", "oil painting with
   visible brush strokes", "clean editorial product photography"), named colours or palettes.
3. **Purpose and type**: say what the image is for ("a poster", "a logo for a cycling café", "an infographic",
   "a social media tile"). Seedream lays the image out for that purpose.

Rules from the guide [O]:
- Concise and precise beats a pile of adjectives.
- Describe complex scenes region by region ("top: …, centre: …, bottom: …").
- Diagrams and infographics: exact technical terms, the format and the layout.

## Length and language

- Soft limit about 600 English words [O]; longer prompts scatter and lose details. Aim for 30–120 words.
- Write the prompt in English. Text that should appear in the image stays in the user's language, inside quotes.

## Text in the image [O]

- Put the exact wording in double quotes: `large title "MIDNIGHT 70%" at the top`.
- Describe placement and size in words ("small text under the bar", "large headline across the top").
- Keep strings short. Describe the font style ("clean serif", "bold sans").

## Colour and style

- Named colours and palettes work [O]. Give the colour name and the hex, e.g. "deep teal (#0E5E6F)" [I].
- Photographic words ("shallow depth of field", "35mm") are fine as style.

## Exclusions

Plain negations are understood ("show only the jacket, nothing else on the hanger") [O], but positive constraints
work better: say what fills the space.

## Settings the platform fixes

Resolution and aspect ratio come from the job settings. Do not name another format in the prompt: Seedream otherwise
takes the format from the text [I]. One job makes one image.

## Reference images

A job may carry reference images (`references`, in order: up to 14 for Seedream 4.5, up to 10 for Seedream 5). Name them by number exactly as "image 1",
"image 2" … and say what to take from each: "the woman from image 1 wearing the jacket from image 2, in the
kitchen of image 3" [O]. Keep every numbered reference of the user; never describe a referenced person anew, since
the image already defines them [I].

## Known weak spots [O]

- Overlong prompts drop elements.
- Vague words like "that one" or "it" pick the wrong target in edits.
- Text without quotes renders less accurately.
- Current facts (today's weather, prices) are not known to the model; put them into the prompt as quoted text.

## Examples

- `A product poster for a dark chocolate bar snapping in half on a slate board, cocoa dust in the air, warm light from the left. Large title "MIDNIGHT 70%" at the top in a clean serif, small text "Single Origin" under the bar. Minimal premium style, deep brown and gold palette.`
- `An infographic explaining how a heat pump works: four numbered steps from left to right (outdoor air, compressor, heat exchanger, warm radiator), each with a simple icon and a one-line caption. Title "How a heat pump works" at the top. Flat vector style, white background, blue for cold and red for warm.`

## Sources

- ByteDance Seedream 4.0–4.5 prompt guide, English (28.09.2026) and Seedream 4.0–5.0 guide, Chinese (11.05.2026)
