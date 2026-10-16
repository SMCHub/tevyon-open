---
name: prompt-gpt-image
version: 1.0.0
kind: prompt
models: [gpt_image_2_5_sunburst, gpt_image_2_5_flare]
max_chars: 4000
min_words: 8
negations: ok
slots: [purpose, setting, subject, details, style, light, camera, text, constraints]
description: >-
  Writes the prompt for GPT Image jobs (GPT Image 2.5, the precise variant, and GPT Image 2.5 Flare, the faster one;
  quality from low to max, up to 10 reference images).
  Trigger: GPT Image, poster, infographic, text in the image, product shot, edit a photo, combine images, UI mockup.
---

# GPT Image prompt skill

OpenAI's image models. Strongest at following long, structured instructions, at exact text in the image, at layouts
(posters, infographics, UI) and at editing given images while keeping the rest. [O] = OpenAI's image prompting guide
and API docs, [I] = inference, not documented.

## Shape: write like a brief to a designer [O]

Plain sentences or short labelled blocks, in this order:

1. **Purpose**: what the image is for ("an Instagram ad for a ceramic studio", "the hero image of a landing page").
2. **Setting and background** first, then the **subject** with concrete details (materials, colours, count, pose).
3. **Key details** that must be right.
4. **Style and medium** ("editorial product photo", "flat vector illustration", "35mm film still").
5. **Light and camera** for photos ("soft window light from the left, 50mm, shallow depth of field").
6. **Text in the image** exactly, in quotes (below).
7. **Constraints**: what must stay or stay out ("no other text", "keep the logo unchanged").

Layout-heavy images (poster, infographic, menu, slide, UI screen) work well as labelled sections: `Header: …`,
`Main image: …`, `Three columns: …`, `Footer: …` [O].

## Text in the image [O]

- Put every word in double quotes and say where it goes and how it looks: `headline "SLOW MORNINGS" in bold
  condensed sans-serif across the top, white on dark teal`.
- Keep the user's spelling letter for letter, including umlauts.
- Dense small print can still fail; keep text blocks short [I].

## Editing and references [O]

- References arrive in order (`references`, up to 10). Name them "image 1", "image 2" … and give each a role:
  "the woman from image 1 wearing the jacket from image 2, in the café of image 3".
- For an edit, say what changes and list what stays: `Change only the jacket to a deep red wool coat. Keep her face,
  hair, pose, the background, the light and the framing exactly the same.`
- Faces and logos stay closest when the prompt names them as unchanged [O].

## Negations

Plain constraints are understood ("no watermark", "no other text", "no extra people") [O]. Say them once, at the end.

## Length and language

- Up to 4000 characters; 40–200 words cover most images, layouts may need more [I].
- Write in English; text that should appear in the image stays in the user's language, in quotes [O].

## Settings the platform fixes

- Aspect ratio (1:1, 2:3, 3:2, 16:9, 9:16) and quality come from the job settings; do not name another format.
- Quality: `low` and `medium` for drafts and ideas, `high` (default) for finished images, `xhigh` and `max` for
  dense detail and small text. Higher quality costs more.
- GPT Image 2.5 and GPT Image 2.5 Flare take the same settings; pick GPT Image 2.5 when detail and text matter.

## Known weak spots

- Real, named people and public figures are refused or altered by the model's moderation [O]; describe an original
  person, or edit the user's own photo with their consent.
- Very small or very many text elements may misspell; check the result and fix a single word with an edit [I].

## Examples

- `Hero image for a minimalist café website. A ceramic coffee cup in matte sage green on a sunlit oak table by a window, early morning, steam rising. The cup sits in the left third, soft background. Editorial product photo, soft window light from the right, 85mm lens, f/1.8. Headline "Slow Mornings" in bold white sans-serif at the top. No other text.`
- `Poster for a jazz night. Header: "BLUE NOTE FRIDAY" in large art-deco letters, gold on deep navy. Main image: a saxophonist in silhouette under a single spotlight, haze. Footer: "24.10. · 20:00 · Kulturhaus" in small clean sans-serif. Flat screen-print style, two colours.`

## Sources

- OpenAI image generation prompting guide and Images API reference (checked 15.10.2026)
