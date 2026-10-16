---
name: prompt-kling
version: 1.1.0
kind: prompt
models: [kling_3_turbo, kling_3_std, kling_3_0_pro, kling_o1]
max_chars: 2500
min_words: 8
negations: ok
slots: [subject, action, setting, camera, light, mood, dialogue, sound]
description: >-
  Writes the prompt for Kling videos (Kling 3.0 Turbo, Kling 3.0, Kling 3.0 Pro and Kling O1: up to 15 seconds,
  fluid motion, sound, from text or a start and end frame).
  Trigger: Kling, lively motion, action, sports, dance, longer clip, character dialogue in several languages.
---

# Kling prompt skill

Kuaishou's video model: fluid, physical motion, clips up to 15 seconds, dialogue in several languages. It rewards a
precise description of the movement and of the camera. [O] = Kling's own guides, [I] = inference, not documented.

## Shape: fill in this order [O]

1. **Subject**: who or what, with the details that must stay stable ("a young courier in a red raincoat").
2. **Action**: what happens, in the order it happens, with speed and weight ("she sprints, plants her foot, and
   leaps the gap"). One complete action per 5 seconds of clip.
3. **Scene**: place, time, weather, what moves in the background.
4. **Camera**: shot size and one move ("side tracking shot at handlebar height, then a slow push-in").
5. **Lighting and mood**: source, colour, feeling.
6. **Dialogue** (only with sound on): `Courier (breathless, cheerful, English): "Last order tonight!"`
   Label each speaker, give tone and language in brackets, the line in quotes. The action comes before the line.
7. **Sound** (only with sound on): effects, ambience and music in plain words ("sizzling woks, rain on tarps").

Use simple words and simple sentences [O]. Kling follows plain, concrete language better than ornate prose.

## Length and language

- Hard limit 2,500 characters. Aim for 50–150 words.
- Write the description in English. Spoken lines can be Chinese, English, Japanese, Korean or Spanish;
  other languages may be spoken in English [O]. Keep the user's lines exact.

## Timing

- Time cues work: "At the 5th second she lifts her visor", "In the final 3 seconds the camera rises" [O].
- Prefer one continuous shot unless the user asks for cuts [I].
- Several speakers: unique labels, the action before each line [O].

## Camera vocabulary that works [O]

push in, pull back, pan, tilt, zoom in, orbit, tracking shot, handheld, stabilised, first-person POV, low angle,
high angle, eye level, profile shot, macro, wide shot, medium shot, close-up, long take.

## Start and end frame

- With a start frame (Kling 3.0, Kling 3.0 Pro, Kling O1): the frame sets the look and the format. Describe only what moves,
  what the camera does and what is heard; do not describe the picture again.
- With an end frame as well: describe the path from the first to the last frame ("the camera glides from the empty
  street to the café door shown at the end").

## Settings the platform fixes

Duration (3–15 s), aspect ratio (16:9, 9:16, 1:1) and sound come from the job settings. With sound off, leave out
dialogue and sound. Longer clips need more action, not more adjectives. Kling 3.0 Turbo always has sound; Kling O1
has none (5 or 10 s): leave out dialogue and sound there.

## Known weak spots [O]

- Complex physics: bouncing balls, throws, many objects interacting.
- Counts: "three dogs" can become two or four. Describe each one instead.
- On-screen text: keep it very short, give the exact words, where they are and on what surface.
- Exclusions can be written into the prompt ("plain wall, nothing on it"); positive wording still works best.

## Examples

- `Rainy night market, steam from food stalls, neon on wet asphalt. A young courier in a red raincoat weaves her bike through the crowd. Side tracking shot at handlebar height, then a slow push-in as she brakes at a noodle stand. At the 5th second she lifts her visor and grins. Courier (breathless, cheerful, English): "Last order tonight!" Sizzling woks, rain drumming on tarps.`
- `Dawn on a misty lake, an old fisherman rows a wooden boat, oars creaking, weathered hands on the oars. Slow push-in from a wide shot to a close-up of his face as he squints at the horizon. Fisherman (low, calm, Spanish): "Hoy la niebla no se va." Birdsong, lapping water.`

## Sources

- Kling 3.0 user guide (06.02.2026)
- Kling blog, prompt guide (07.08.2026)
- Kling text-to-video prompt guide (24.11.2025)
