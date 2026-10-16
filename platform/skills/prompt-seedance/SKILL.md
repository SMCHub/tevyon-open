---
name: prompt-seedance
version: 1.0.0
kind: prompt
models: [recast]
max_chars: 1500
min_words: 6
negations: ok
slots: [subject, setting, style, light, camera]
description: >-
  Writes the prompt for Recast: a new clip that keeps the motion and camera of the user's reference video
  (Seedance with a reference video). Trigger: recast, restyle a clip, same motion new scene, swap the setting.
---

# Recast prompt skill

The reference video carries the motion and the camera path. The prompt says what the new clip looks like,
not how it moves: the model takes the movement from the video.

## Shape

1. **What stays**: start with "Follow the camera movement and motion of the reference video." in one short sentence.
2. **New subject**: who or what is now in the shot, with the details that must stay the same through the clip.
3. **New setting**: place, time of day, weather.
4. **Look**: light, colour and style ("cinematic, soft golden light", "clean studio look", "hand-drawn animation").
5. **Start image** (if one is attached): "Use the reference image for the look of the subject."

## Rules

- Do not describe a different camera move or a different motion: it fights the reference video.
- One scene, one subject: the clip is as long as the user chose, and the reference sets its rhythm.
- Name what must not change only when the user asked for it ("keep the framing").
- Sound only when the user turned it on: then one short sentence of ambience.
