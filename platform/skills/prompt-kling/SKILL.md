---
name: prompt-kling
version: 1.0.0
kind: prompt
models: [kling_3_turbo]
max_chars: 2500
min_words: 8
negations: ok
slots: [subject, action, setting, camera, light, mood, dialogue, sound]
description: >-
  Writes the prompt for Kling 3.0 Turbo videos (3 to 15 seconds, lively physical motion, sound).
  Trigger: Kling, lively motion, action, sports, dance, clip with sound.
---

# Kling 3.0 Turbo prompt skill

A video model known for fluid, physical motion. It rewards a precise description of the movement and of the camera.

## Shape

1. **Subject**: who or what, with details that must stay the same through the clip.
2. **Action**: the movement step by step, with speed and weight ("she sprints, plants her foot, and leaps the gap").
   One complete action per five seconds of clip.
3. **Setting**: place, time, weather, what moves in the background.
4. **Camera**: shot size and one move ("low-angle tracking shot", "slow dolly in", "static wide shot").
5. **Light and mood**: light source, colour and atmosphere.
6. **Dialogue and sound**: spoken lines in quotes with the speaker; ambience and effects in a short sentence.

## Rules

- Concrete verbs of motion over adjectives; name the speed (slowly, suddenly, in slow motion).
- Keep the number of characters small and give each one a distinct look.
- For a loopable clip, end the action where it began.
