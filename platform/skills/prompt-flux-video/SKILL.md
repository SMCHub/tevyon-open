---
name: prompt-flux-video
version: 1.0.0
kind: prompt
models: [flux_3_video]
max_chars: 3500
min_words: 8
negations: ok
slots: [camera, subject, action, setting, light, style, sound]
description: >-
  Writes the prompt for FLUX 3 Video jobs (lip-synced dialogue in many languages, several shots per clip, text in the
  scene; 5 to 20 seconds, 720p or 1080p, sound, from text or a start and end frame).
  Trigger: FLUX 3 Video, FLUX video, multilingual dialogue, multi-shot video, animated title, 20-second video.
---

# FLUX 3 Video prompt skill

Black Forest Labs' video model: sound from the same generation, hard cuts inside one clip, readable text, looks from
live action to cel animation. [O] = Black Forest Labs' documentation, [C] = community guides, [I] = inference.

## Shape: fill in this order

A director's brief, not a list of objects [O]: one paragraph, `[camera] shot of [subject] [action] in [setting].
[details]`, sound last. Pin only what matters; over-stuffing blurs motion.

1. **Camera** [O]: one framing term and one move ("low tracking shot"). Write "locked-off" for a still frame.
2. **Subject**: who or what, with two or three visible details. Reuse the exact words whenever it returns.
3. **Action** [O]: one motivated event, counted out in concrete verbs.
4. **Setting** (place, time, weather), then **light** (source, quality, palette).
5. **Style** [O]: medium and era when they matter ("dashcam footage", "1990s hand-drawn cel animation"). No quality
   tags such as "4K" or "masterpiece".
6. **Sound**, last (see below).

## Sound (only with sound on) [O]

Four layers, only those the scene needs: speech, ambience, effects, music. Speech sits inside the action, the rest in
one closing sentence: `Audio: rain against the window, the mug clicks on the saucer, a sparse piano low in the mix.`

- **Dialogue**: exact words in quote marks with a visible speaker or the word `voiceover`, else the line becomes
  burned-in text. Keep the user's words exactly, add `says exactly once`, end with `No on-screen text, no subtitles.`
- **Language**: name and lock it, `says in German, every word in German: "…"`.
- **Room for the line**: at most about two spoken words per second [I]. Several speakers: short separate turns.
- **Music**: name it or write `No music.`

## Several shots in one clip [O]

- `SHOT ONE: … HARD CUT. SHOT TWO: …`, or timecodes (`Shot 1 [0.0s-3.0s]: …`), the last ending at the job's
  duration. No cut wanted: `One continuous unbroken shot.`
- Two or three shots per clip, each strongly different in scale. Same subject words in every shot. Pacing [C]: one
  shot 5–7 s, two 8–12 s, three 12–18 s.

## Start and end frame [O]

- **Start frame**: `The video begins exactly on the provided image.`, then only what moves, in order, plus camera and
  sound. Call its content "the man in the image".
- **Start and end frame**: `The video begins exactly on the first provided image and ends exactly on the second.`,
  then the stages of the change in order. Both frames should share subject, scene and camera.

## Text in the picture and negations

- Titles, signs and lower-thirds render well [O]: quote the exact words, where they sit and how they look, then close
  with `No other text, no subtitles.`
- Short guardrails at the end work [O]: `No on-screen text, no subtitles.`, `No music.`, `No other speech.`

## Length, language and settings the platform fixes

- Aim for 40–150 words per shot [I]; past a few hundred words, late clauses get dropped [C]. Write in English.
- Duration (5–20 s), resolution (720p or 1080p), aspect ratio and sound come from the job settings: do not name them.
  5 s holds one event, 10–20 s hold scenes that breathe or carry dialogue.
- With sound off, drop every spoken line and the audio sentence.

## Known weak spots

- Unattributed quotes become text, lines repeat without `exactly once`, long lines get cut off [O].
- Real, named people are not allowed: describe an original character.

## Examples

- `Medium close-up, slow push-in. A ferry deckhand in a faded orange life vest coils a wet rope on the deck of a small lake ferry at dawn, mist on the water behind her. She glances at a passenger beside camera and says exactly once, dry and unhurried: "Hold the rail. It gets choppy past the island." Cool morning light, muted teal and orange, 35mm documentary look. Audio: the idling diesel engine, water slapping the hull, one gull overhead. No music. No on-screen text, no subtitles.`

## Sources

- Black Forest Labs docs (docs.bfl.ai, 15.10.2026): video prompting guides and API reference
