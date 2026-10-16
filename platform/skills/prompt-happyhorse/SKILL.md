---
name: prompt-happyhorse
version: 1.0.0
kind: prompt
models: [happyhorse_1_1]
max_chars: 800
min_words: 8
negations: ok
slots: [subject, action, setting, light, style, camera, dialogue, sound]
description: >-
  Writes the prompt for HappyHorse video jobs (HappyHorse 1.1 from text or a start image: native sound and lip sync, short multi-shot scenes, 5 to 15 seconds, up to 1080p).
  Trigger: HappyHorse, short drama scene, multi-shot clip with dialogue, Mandarin or Cantonese dialogue, photo to video
  with sound.
---

# HappyHorse prompt skill

Alibaba's video model from a different team than Wan. Picture and sound come in one pass (dialogue with lip sync,
effects, music), including short multi-shot stories. Strong at real-looking scenes with emotion and atmosphere: short
drama, ads, B-roll [C]. [O] = Alibaba, [C] = community guides and hands-on tests, [I] = inference, not documented.

## Shape: fill in this order

1. **Subject** [C]: who or what, with two or three stable details. Open with subject and action.
2. **Action**: one visible thing, with speed and size. Show emotion through face and body [O].
3. **Setting**: place, time, weather.
4. **Light and style** [C]: one concrete cue each ("low sun from the left", "16mm grain").
5. **Camera** [C]: shot size plus one move.
6. **Dialogue**, only if asked: in double quotes, with speaker and language:
   `The grandmother says softly in Cantonese: "…"`. Keep the user's words exact; one short sentence per line.
7. **Sound, always** [C]: what we hear. Without it the model picks its own, often music nobody asked for.

## Rules

- The model reads at most 800 characters and cuts the rest: 20–60 words for one shot, up to about 110 for a
  storyboard [I]. Plain sentences, no tag lists or weights [C].
- Sound is always on [O]. Plain exclusions work for concrete risks: `No music.` `No dialogue.` `No on-screen text.`
- Several shots: `Shot 1 (0-4s): Wide shot, … Shot 2 (4-8s): Close-up, …`, covering the job's duration [C]. Close
  with a hold line ("Same yellow oilskin in every shot.").
- Start image: the clip opens on it and takes its format [O]. Describe only what moves and
  what is heard; call the content "the woman in the image"; name what must stay unchanged [C].
- Duration, resolution and aspect ratio come from the job settings; do not restate them.

## Known weak spots [C]

- Busy physics and complex scenes: keep one main action per shot.
- On-screen text: two or three words at most; tie them to a surface: `a shop sign reads "OPEN"` [I].
- One or two speakers work best; more fall apart.

## Examples

- `An old fisherman in a yellow oilskin hauls a dripping net over the side of a small wooden boat at dawn, rain needling the grey sea. Soft overcast light, muted greens, 16mm grain. Medium shot from the bow, slow push-in to his weathered hands. Rain drumming on the hull, the rope creaking, distant gulls. No music.`
- Start image: `The woman in the image looks up from her phone and smiles as the tram doors slide open, her scarf lifting in the draught. Keep her face, hair and coat unchanged. Slow push-in, eye level. Tram bell, doors hissing, quiet street ambience. No music.`

## Sources

- Alibaba Cloud Model Studio, HappyHorse API reference (15.10.2026)
- Creator-community prompt guides and hands-on tests for 1.0 and 1.1 (15.10.2026)
