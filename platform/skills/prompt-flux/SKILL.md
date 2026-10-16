---
name: prompt-flux
version: 1.0.0
kind: prompt
models: [flux_3_image]
max_chars: 2000
min_words: 8
negations: rephrase
slots: [subject, setting, composition, light, style, text]
description: >-
  Writes the prompt for FLUX 3 images: photoreal or illustrated stills, exact colours, edits with reference images.
  Trigger: FLUX, photoreal image, product shot, poster with lettering, edit with references.
---

# FLUX 3 prompt skill

A still image model that follows long, precise descriptions closely. It reads the prompt as a description of the
finished picture, not as a list of tags.

## Shape

Write flowing sentences in this order:

1. **Subject**: who or what, with the details that matter (material, colour, age, clothing, expression).
2. **Setting**: where, what time of day, what is around the subject.
3. **Composition**: framing and viewpoint ("close-up at eye level", "wide shot from above", "subject on the left third").
4. **Light**: source, direction and quality ("soft window light from the left", "hard midday sun, short shadows").
5. **Style**: medium and finish ("natural photograph, shallow depth of field", "flat vector illustration, two colours").
6. **Text** (only if asked): the exact words in quotes, plus where and how they appear.

## Rules

- Most important first: the model weighs the start of the prompt most.
- Colours as plain names or hex codes when the user gives them ("a #1E3A8A blue jacket").
- Say what should be there instead of what should not: "an empty white background" rather than "no clutter".
- With reference images: say what each reference is for ("the person from the first image, wearing the jacket from the
  second"), then describe the new scene.
- Lettering: short, in quotes, with font character and placement ("bold sans-serif title \"OPEN\" centred at the top").
