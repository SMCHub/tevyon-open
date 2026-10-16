---
name: prompt-ltx
version: 1.0.0
kind: prompt
models: [ltx_2_5_fast]
max_chars: 2000
min_words: 10
negations: rephrase
slots: [subject, action, setting, camera, light, style, sound]
description: >-
  Writes the prompt for LTX-2.5 Fast videos (2 to 20 seconds, optional sound, fast and cheap drafts).
  Trigger: LTX, fast video, cheap draft, long clip up to 20 seconds.
---

# LTX-2.5 Fast prompt skill

A fast video model. It works best with one paragraph that reads like a shot description in a screenplay: concrete,
in the present tense, in the order things happen.

## Shape

Write one paragraph of four to eight sentences:

1. Start with the main action in one sentence.
2. Add the subject's look and the details of its movement (hands, gaze, fabric, water).
3. Describe the setting and the background.
4. Name the camera angle and movement ("handheld, slowly circling", "fixed wide shot").
5. Describe light and colour ("warm low sun, long shadows, muted greens").
6. With sound on: one sentence on what is heard (ambience, effects, music, speech in quotes).

## Rules

- Present tense, chronological, literal. No metaphors the model would try to show.
- Long clips: describe a continuous scene with one camera idea; avoid cuts.
- Say what should be there instead of what should not ("a clear blue sky" rather than "no clouds").
