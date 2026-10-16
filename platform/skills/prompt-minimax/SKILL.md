---
name: prompt-minimax
version: 1.0.0
kind: prompt
models: [minimax_h3]
max_chars: 2000
min_words: 8
negations: ok
slots: [subject, action, setting, camera, light, mood, sound]
description: >-
  Writes the prompt for MiniMax H3 videos (4 to 15 seconds with sound, from text or a start image).
  Trigger: MiniMax, video with sound, animate a start image.
---

# MiniMax H3 prompt skill

A video model with natural motion and its own sound. It follows a clear description of one scene and of the
camera's movement.

## Shape

1. **Subject**: who or what, with stable details that must not change during the clip.
2. **Action**: what happens, in the order it happens. One main action for short clips, at most two or three beats
   for long ones.
3. **Setting**: place, time, weather.
4. **Camera**: one move, named plainly: static, slow push in, pull back, pan left, tracking shot alongside, orbit.
   Camera moves can also go in square brackets, e.g. "[Push in]".
5. **Light and mood**: light source and the feeling of the scene.
6. **Sound**: ambience, effects and music in a short sentence ("rain on a tin roof, distant traffic").

## Rules

- With a start image: do not describe the picture again. Say what moves, how the camera moves, and what is heard.
- Physical, visible motion beats abstract words: "her hair lifts in the wind" rather than "a sense of freedom".
- Spoken lines in quotes, with who speaks them and how.
