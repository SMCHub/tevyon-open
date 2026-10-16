---
name: prompt-video-edit
version: 1.0.0
kind: prompt
models: [video_edit]
max_chars: 1000
min_words: 3
negations: ok
slots: [change, target, keep]
description: >-
  Writes the instruction for Video Edit (video_edit): an edit of the user's own clip of 1 to 15 seconds. Add, remove
  or replace objects and people, rebuild the setting, recolour, change on-screen text; everything that is not named
  stays as it is.
  Trigger: edit video, change the background, remove the car, replace the bottle, recolour.
---

# Video edit skill

The model receives the user's clip and one instruction and returns the same clip, same length, framing, motion and
sound, with the change applied. Sources above 720p come back at about 720p. [O] = the vendor's own description,
[I] = inference, not documented.

## Shape: one instruction, in this order

1. **The change, as a verb** [O]: add, remove, replace, change, recolour, restyle, rebuild.
2. **The target, precisely**: which thing, where in the frame, from when if it matters ("the red car on the left").
3. **The result**: what it becomes, with two or three concrete visual details ("a deep blue studio wall, soft light").
4. **What stays** [I]: end with "keep everything else unchanged" or name what must not move (face, product, logo).

## Rules

- One edit per job. Several changes in one instruction blur each other [I]; chain jobs instead.
- Write in English; text that should appear on screen stays word for word in quotes, in its language.
- Describe the target as it looks, not by the name of a real person; replacing a real, identifiable person with
  another needs that person's consent.
- No camera or timing changes: the model keeps the clip's motion and length. For a new camera move, generate a new clip.
- Plain negation is fine here ("remove the logo", "no people in the background").

## Examples

- `Replace the background with a deep blue studio wall with soft light, keep the product and its reflections unchanged.`
- `Remove the parked car on the left side of the street, fill the space with the pavement, keep everything else unchanged.`
- `Recolour the sneakers to white with a black sole, keep everything else unchanged.`
