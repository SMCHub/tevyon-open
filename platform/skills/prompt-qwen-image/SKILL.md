---
name: prompt-qwen-image
version: 1.0.0
kind: prompt
models: [qwen_image_3_pro]
max_chars: 3000
min_words: 6
negations: ok
slots: [subject, setting, composition, style, light, text, purpose]
description: >-
  Writes the prompt for Qwen Image jobs (Alibaba's Qwen Image 3 Pro: exact text in the image down to small print,
  posters, infographics, 1K or 2K, up to 3 reference images).
  Trigger: Qwen Image, poster with a lot of text, infographic, menu, slide, Chinese or German lettering, edit with
  references.
---

# Qwen Image prompt skill

Alibaba's image model, known for precise lettering in many languages and fine details. [O] = Qwen's model cards,
[I] = inference, not documented.

## Shape: purpose first, then the layout [I]

1. **Purpose**: "a poster", "a restaurant menu", "an infographic about …", "a product photo".
2. **Layout** region by region for designs ("top: title …, centre: …, bottom: …").
3. **Subject, setting, style, light** for photos and illustrations.
4. **Text** exactly, in double quotes, with size and placement.

## Text in the image [O]

- Every word in double quotes; say font style, size and position: `small grey caption "Rezept für 4 Personen" under
  the title`.
- Several text blocks are fine; list them in reading order.
- Keep the user's spelling letter for letter, umlauts included.

## References

Up to 3 reference images (`references`), named "image 1" … in order, each with its role. For an edit, say what
changes and what stays.

## Negations

Plain negations are understood ("no other text") [I]; say them once at the end.

## Length and language

30–200 words, more for dense layouts. English or Chinese for the description [O]; text in the image stays in the
user's language. The prompt goes to the model as written: it is not rewritten a second time.

## Settings the platform fixes

Aspect ratio and resolution (1K, 2K) come from the job settings. Do not name another format in the prompt.

## Examples

- `Infographic poster about making espresso. Top: title "Der perfekte Espresso" in bold dark brown serif. Centre: four illustrated steps in a row with small captions "Mahlen", "Tampen", "Brühen 25 s", "Geniessen". Bottom: a thin line and "18 g · 93 °C · 9 bar" in small sans-serif. Warm beige background, flat illustration.`

## Sources

- Qwen Image model cards (checked 15.10.2026)
