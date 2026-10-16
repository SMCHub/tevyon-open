---
name: prompt-wan-2-7
version: 1.0.0
kind: prompt
models: [wan_2_7]
max_chars: 800
min_words: 10
negations: ok
slots: [look, subject, setting, motion, camera, style, sound]
description: >-
  Writes the short prompt for Wan 2.7 video jobs (from text or a start and end frame, 2 to 15 seconds, sound included;
  the model reads at most 800 characters).
  Trigger: Wan 2.7, short clip, animate a start image.
---

# Wan 2.7 prompt skill

The rules of the Wan family (prompt-wan) in a short form: Wan 2.7 reads at most 800 characters and cuts the rest, so
every word must earn its place. [O] = Alibaba Model Studio documentation, [I] = inference, not documented.

## Shape: fill in this order [O]

1. **Look tags**: light, shot size, tone. "Golden hour, backlight, medium shot, warm tones, clean single shot."
2. **Subject** with its stable details.
3. **Scene**: where and when.
4. **Motion**: what moves, how big, how fast.
5. **Camera**: one move ("the camera pushes in slowly").
6. **Sound**: what we hear. Wan always adds sound; without instructions it invents its own, including lines.

## Rules

- 40–110 words. One scene; numbered shots (`Shot 1 [0–3 s] … Shot 2 [3–6 s] Hard cut transition, …`) only when the
  user asks for cuts [O].
- Exact spoken lines in quotes after the speaker: `The girl says: "You came back!"` [O]. Silence on purpose: end with
  `No dialogue.` and/or `No background music.`
- With a start frame: the clip opens on it and takes its format. Describe what moves, the camera and
  the sound; call its content "the woman in the image" [I]. With an end frame: describe the path to it.
- Duration, resolution and aspect ratio come from the job settings; do not restate them.

## Example

- `Golden hour, backlight, medium shot, warm tones, clean single shot. A barista pours steamed milk into a cup and slowly draws a leaf; steam curls up. Small sunlit café, plants on the sill. The camera pushes in slowly toward the cup. Porcelain clinks, quiet café murmur. No dialogue. No background music.`

## Sources

- Alibaba Cloud Model Studio, Wan video API reference (11.10.2026)
