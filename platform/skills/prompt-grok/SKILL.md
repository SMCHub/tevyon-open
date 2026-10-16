---
name: prompt-grok
version: 1.0.0
kind: prompt
models: [grok_imagine_1_5, grok_imagine_1_5_lite]
max_chars: 4000
min_words: 8
negations: rephrase
slots: [subject, setting, action, camera, light, style, sound]
description: >-
  Writes the prompt for Grok Imagine video jobs (Grok Imagine 1.5 and 1.5 Lite: 1 to 15 seconds, native sound with
  lip-synced speech, from text or a start image).
  Trigger: Grok, Grok Imagine, xAI video, cheap video draft, talking character, video with sound, image to video.
---

# Grok Imagine video prompt skill

xAI's video family: text to video and image to video with sound effects, ambience and lip-synced speech in one pass.
Grok Imagine 1.5 renders up to 1080p; 1.5 Lite is the cheaper, faster model for simple shots, offered up to 720p.
[O] = the maker's API docs, news posts and policy, [C] = community guides and reviews, [I] = inference, not documented.

## How the model reads a prompt

- A prompt-rewriting language model on the maker's side rewrites every prompt first [O]. What you leave open gets
  decided for you, often with music nobody asked for [C]. Make each decision once, plainly.
- Text to video first renders a still from the prompt, then animates it [O]. Open with that picture, like a photo
  caption: shot size, subject, place [I].
- There is no seed: the same prompt gives a new shot every time [O].

## Shape: fill in this order

1. **Subject** [O]: who or what, with two or three stable visual details and the count when it matters.
2. **Setting**: place and time ("a wooden pier at dawn, mist on the water").
3. **Action** [C]: one main action, physical and with a speed. Show feeling through the body, not by naming it.
4. **Camera** [C]: shot size plus one move ("medium close-up, slow push in"). Keep it before light and sound.
5. **Light** [O]: source, direction, hardness.
6. **Style**: look and grade ("35mm film look, fine grain"). "Cinematic" alone says nothing [C].
7. **Sound, last**: see below.

**Several beats:** one main action per clip is safest [C]. For 8 to 15 seconds, two or three beats in order, joined
with "then" [O], or time-coded (`(0-5s) … (5-10s) …`) inside the job's duration [C]. Prefer one continuous shot.

## Sound

- Sound effects, ambience and dialogue come in the same pass [O]. Name the ambience and one or two effects that land
  on the action, then say whether there is music: `Sound: waves lapping at the pilings, distant gulls. Music: none.`
- Dialogue [C]: the line in double quotes after speaker and verb: `He says quietly: "Weather's turning."` Keep the
  user's words exactly; one or two short sentences per line. Name the language: `says in German: "Bis morgen."`
- Every clip of this family comes with sound: always describe it.

## Start image [O]

- The image becomes the first frame and sets the format; the prompt says what happens next. Describe motion, camera
  and sound only; call the content "the woman in the image".
- Name what must stay unchanged ("keep the label readable", "same face") [C].

## Length and language

Aim for 50–150 words, four to six sentences [I]. Write in English; spoken lines stay in the user's language.

## Say what is there

There is no negative-prompt field [O], and avoid lists get ignored [O]. Write the wanted state: "an empty beach"
instead of "no people", "locked-off camera" instead of "no shake". Exception: `Music: none.` [C]

## Settings the platform fixes

Duration (1–15 s), resolution and aspect ratio come from the job settings; with a start image, the image's format
wins [O]. Lite suits simple videos: one subject, one action, one move [O].

## Known weak spots

- Big effects and complex physical contact behave unpredictably [C]. Keep actions simple and continuous.
- Lip-sync is approximate and degrades with long lines [C].
- Text in the image comes out garbled [C]; write wanted text as text (`a sign reading OPEN`), since double-quoted
  lines are taken as speech [I].
- Moderation sometimes blocks harmless prompts [C]: rephrase neutrally.

## Examples

- `Medium close-up of an old fisherman in a yellow oilskin coat mending a green net on a wooden pier at dawn, mist on the water behind him. He pulls a knot tight with his teeth, then slowly lifts his eyes to the grey horizon. Slow push in at eye level. Soft pink light from the left, cool blue shadows, 35mm film look with fine grain. Sound: waves lapping at the pilings, distant gulls, the net rope creaking. He says quietly: "Weather's turning." Music: none.`
- From a start image: `The perfume bottle in the image stays centred while a slow ribbon of golden mist curls around it and settles on the black stone. Keep the label sharp and readable. Slow orbit to the right, then the camera holds still for the last second. Sound: a soft airy whoosh, a faint glass chime, quiet room tone. Music: none.`

## Sources

- xAI API docs: video generation, image-to-video, image prompting guide (docs.x.ai, 15.10.2026)
- Community video prompting guides and reviews (15.10.2026)
