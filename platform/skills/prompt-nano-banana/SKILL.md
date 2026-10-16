---
name: prompt-nano-banana
version: 1.0.0
kind: prompt
models: [nano_banana_pro, nano_banana_2]
max_chars: 3500
min_words: 6
negations: rephrase
slots: [subject, action, setting, composition, style, light, camera, text]
description: >-
  Writes the prompt for Nano Banana jobs (Nano Banana Pro and Nano Banana 2, Google's image models: text to image,
  editing, up to 14 reference images, exact text in the image, 1K to 4K).
  Trigger: Nano Banana, Gemini image, edit a photo, change one thing in an image, combine images, poster with text,
  product shot, consistent character.
---

# Nano Banana prompt skill

Google's image family. Strong at following long, specific descriptions, at editing a given image while keeping the
rest, at combining several reference images and at exact text in the image. [O] = Google's own documentation and
prompting guides, [I] = inference, not documented.

## Shape: describe a scene, not a keyword list [O]

Write one or two sentences of prose in this order, starting with a strong verb for what to do:

1. **Subject** with concrete details ("a ceramic coffee cup in matte sage green").
2. **Action** or state ("steam rising from it").
3. **Setting and context** ("on a sunlit oak table by a window, early morning").
4. **Composition** ("close-up, the cup in the left third, soft background").
5. **Style** ("photorealistic product photography" or "flat vector illustration").
6. **Light** ("soft window light from the right, gentle shadow").
7. **Camera and lens** for photorealism ("85mm lens, f/1.8, shallow depth of field").
8. **Text in the image**, if wanted (see below).

Say what it is for when it helps ("hero image for a minimalist skincare brand"). Split a complex scene into steps:
"First … Then … Finally …".

## Text in the image [O]

- Put the exact words in quotes and describe the font: `with the headline "Slow Mornings" in bold white sans-serif`.
- Keep the user's words letter for letter. Short headlines work best; small text and long sentences can still fail.
- Text in another language than the prompt is fine: write the prompt in English, the quoted text as the user wrote it.

## Editing a given image [O]

- Pattern: `Using the provided image, change only the [element] to [new]. Keep everything else exactly the same,
  preserving the original style, lighting and composition.`
- Name what must stay: a face, a logo, a product. For a face: describe it and add "remains completely unchanged".

## Several images [O]

- References arrive in order (`references`, up to 14). Refer to them as "image 1", "image 2" … and give each a role
  (person, product, background, style, pose): `Place the person from image 1 at the café table from image 2, keep her
  face and outfit unchanged, match the warm evening light of image 2.`
- Fewer references give steadier results; about five people stay steady at most [O].

## Exclusions [O]

Describe what is there instead of "no …": "an empty, deserted street" instead of "a street without cars",
"a clean background" instead of "no clutter".

## Length and language

- No hard limit [O]; 30–150 words are plenty. Write in English; text in the image stays in the user's language.

## Settings the platform fixes

Aspect ratio and resolution (1K, 2K, 4K) come from the job settings. Do not contradict them in the prompt.

## Known weak spots

- Real, named people and celebrities are filtered [O]; describe an original character, or edit the user's own photo
  with their consent.
- Sometimes answers with text only or stops early [O]: ask explicitly to "create an image of …".
- After many rounds of edits a face can drift [O]: start again from the original with a detailed description.
- Every image carries Google's invisible SynthID mark [O]; it stays in the file.

## Examples

- `Create a photorealistic close-up of a ceramic coffee cup in matte sage green with steam rising, on a sunlit oak table by a window in the early morning. The cup sits in the left third, soft background. Soft window light from the right. 85mm lens, f/1.8. Hero image for a minimalist café, with the headline "Slow Mornings" in bold white sans-serif at the top.`
- `Using the provided image, change only the jacket to a deep red wool coat. Keep everything else exactly the same, preserving her face, the pose, the lighting and the composition.`

## Sources

- Google Gemini image generation docs (09.10.2026) and prompting guides (2025-08, 2025-11, 2026-03)
