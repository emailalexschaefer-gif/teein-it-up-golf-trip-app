# Local test assets

`public/audio/celebration-applause.mp3` is an **original** clip, synthesised from random noise and simple oscillators
by `generate_applause.py` (seeded, reproducible). It contains no recorded or third-party audio, so there is no licence to clear.

The recovered V62 demo applause has **unverified** source and rights and is deliberately NOT used or shipped. An automated test fails if a copy appears in `local-test-assets/`.

To replace the clip with a recorded, licensed one: overwrite `public/audio/celebration-applause.mp3` (short MP3, about 9-10 s; the confetti follows the clip length) and keep the licence record.
Kill switch: `NEXT_PUBLIC_PRESENTATION_APPLAUSE=off` in Vercel disables applause without a code change.
