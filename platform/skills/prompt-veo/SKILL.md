---
name: prompt-veo
version: 1.1.0
kind: prompt
models: [veo_3_1_lite, veo_3_1, veo_3_1_fast]
max_chars: 1500
min_words: 8
negations: ok
slots: [subject, action, setting, style, camera, light, dialogue, sound]
description: >-
  Writes the prompt for Veo videos (Veo 3.1, Veo 3.1 Fast and Veo 3.1 Lite: 4 to 8 seconds, with or without sound,
  from text or a start and end frame).
  Trigger: Veo, short clip with dialogue or sound, cheap draft video, animate a start image.
---

# Veo prompt skill

A short-clip video model with native sound: speech, effects and ambience come from the prompt. Clips are 4 to 8
seconds, so one scene and one idea per clip.

## Shape

1. **Subject**: who or what, with clear visual details.
2. **Action**: what the subject does during the clip.
3. **Setting**: place, time of day, weather.
4. **Style**: the look ("cinematic live action", "stop-motion clay", "documentary handheld").
5. **Camera**: shot size, angle and movement ("medium shot, slow push in").
6. **Light**: source and mood ("golden hour backlight", "cool neon at night").
7. **Sound**: with sound on, dialogue in quotes after the speaker ("The barista says: \"Your usual?\""), then effects
   and ambience ("SFX: milk steamer hissing. Ambience: quiet café chatter").

## Rules

- With a start image: describe only what moves and what is heard; the image already sets the look.
- With an end frame as well (Veo 3.1, Veo 3.1 Fast): describe the path from the first frame to the last.
- One moment per clip: at most one main action for 4 s, two linked actions for 8 s.
- Veo 3.1 Lite follows complex prompts less closely than Veo 3.1: keep its scenes simple.
- Keep dialogue short enough to be spoken within the clip (about two words per second).
- Without sound: leave the sound part out entirely.
