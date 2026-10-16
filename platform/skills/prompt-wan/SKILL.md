---
name: prompt-wan
version: 1.0.0
kind: prompt
models: [wan_3_0, wan_3_0_prime]
max_chars: 4000
min_words: 10
negations: ok
slots: [look, subject, setting, motion, camera, style, sound]
description: >-
  Writes the prompt for Wan video jobs (Wan 3.0 and Wan 3.0 Prime: 2 to 30 seconds, long structured prompts, numbered
  shots, sound, from text or a start and end frame).
  Trigger: Wan, long video, structured multi-shot video, Chinese or English prompts.
---

# Wan prompt skill

Alibaba's Wan video models: they follow long, structured prompts well, support numbered shots with hard cuts and
generate matching sound. [O] = Alibaba Model Studio documentation, [C] = community, [I] = inference, not documented.

## Shape: fill in this order [O]

1. **Look tags first**: light, shot size, tone, number of shots. "Golden hour, backlight, medium shot, warm tones, clean single shot."
2. **Subject**: the main entity with its stable details.
3. **Scene**: where and when.
4. **Motion**: what moves, how big, how fast ("slowly draws a leaf", "a quick half turn").
5. **Camera**: shot size, angle, lens, movement ("the camera pushes in slowly toward the cup").
6. **Style**: film look, era, palette.
7. **Sound**: what we hear. Without instructions Wan makes its own sound, including invented lines.

Wan rewards complete, structured prompts more than short ones [C]: fill every slot.

## Length and language

- Up to 4,000 characters here. Aim for 60–200 words; long clips (15–30 s) need more action, not more adjectives.
- English or Chinese [O]. Write the description in English; spoken lines stay in the user's language.
- The prompt goes to the model as written: it is not rewritten a second time.

## Sound and dialogue [O]

- Exact lines: `The girl says: "You came back!" in a trembling, happy voice.` With quotes the words stay exact;
  without them Wan invents its own lines.
- Voice = words + emotion + tone + speed + timbre + accent.
- Several speakers: `[Character A: agent in a black suit, raspy voice]: "…"`, the action before each line.
- Silence on purpose: end with `No dialogue.` and/or `No background music.` [O].
- Lip sync to exact words is not reliable; keep lines short [O].
- With sound off in the job settings, leave out dialogue and sound.

## Several shots [O]

- Syntax: `Overall description. Shot 1 [0–3 s] … Shot 2 [3–6 s] Hard cut transition, … Shot 3 [6–10 s] …`, the last
  shot ending at the job's duration.
- `Generate single shot.` forces one continuous shot.
- Declare cuts only as numbered shots, never as "suddenly we are in another place" in prose [O].

## Start and end frame

- With a start frame the clip opens on it and takes its format. Describe what moves, the camera and the sound; call
  its content "the woman in the image" instead of describing it again [I].
- With an end frame as well: describe the path from the first to the last frame.

## Camera vocabulary that works [O]

camera pushes in, pulls out, moves left/right, fixed camera, tracking shot, orbiting camera movement (keep the arc
under 45°), close-up to extreme wide shot, two-shot, clean single shot, low angle, top-down, high angle,
over-the-shoulder, aerial shot, long-focus lens, wide-angle lens.

## Settings the platform fixes

Duration (2–30 s), resolution, aspect ratio and sound come from the job settings. Do not restate them.

## Known weak spots

- Fast motion blurs; fine jewellery jitters; details drift between clips [C].
- Text and signs render only approximately [O].
- Real people by name: not allowed; describe an original character.

## Examples

- `Golden hour, backlight, medium shot, warm tones, clean single shot. A barista pours steamed milk into a cup and slowly draws a leaf; steam curls up. Small sunlit café, plants on the sill. The camera pushes in slowly toward the cup. Porcelain clinks, quiet café murmur. No dialogue. No background music.`
- `Warm documentary short about a lost dog coming home. Shot 1 [0–3 s] Wide shot, a scruffy terrier trots down a snowy village road at dusk. Shot 2 [3–6 s] Hard cut transition, close-up, its ears perk up at a lit doorway. Shot 3 [6–10 s] Hard cut transition, a girl kneels and hugs it. The girl says: "You came back!" in a trembling, happy voice. Soft piano music.`

## Sources

- Alibaba Cloud Model Studio, text-to-video prompt guide and API reference (11.10.2026)
