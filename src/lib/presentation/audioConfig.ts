// Presentation audio configuration.
//
// MUSIC: "Funky Clubhouse Mix" -- an original generated instrumental,
// approved for use. Served as a static asset (no database storage, no signed links).
//
// APPLAUSE: "celebration-applause.mp3" is an ORIGINAL clip synthesised for this app from random
// noise and oscillators (no recorded or third-party audio, so no licence to clear). It replaces the
// recovered V62 demo recording, which had no established licence and is NOT used.
// The generator script is kept in local-test-assets/ so the clip is reproducible.
// To swap in a recorded, licensed clip later: replace public/audio/celebration-applause.mp3.
// Kill switch: NEXT_PUBLIC_PRESENTATION_APPLAUSE=off removes applause everywhere without a code change.
export const MUSIC_SRC = '/audio/funky-clubhouse-mix.mp3'
export const APPLAUSE_SRC: string | null =
  process.env.NEXT_PUBLIC_PRESENTATION_APPLAUSE === 'off' ? null : '/audio/celebration-applause.mp3'

export const MUSIC_VOLUME = 0.25
/** Music fade to silence on the champion slide / audible video. */
export const FADE_OUT_MS = 500
/** Music fade back in (leaving the champion slide, video end, toggle on). */
export const FADE_IN_MS = 700
/** Champion slide shown, music stopped, then applause + confetti begin together. */
export const REVEAL_DELAY_MS = 1000
/** Applause clip is ~9.43 s; this is used only if its real duration is unknown. */
export const FALLBACK_CELEBRATION_MS = 9400
/** Confetti tracks the applause length, kept within 9-10 s. */
export const CONFETTI_MIN_MS = 9000
export const CONFETTI_MAX_MS = 10000
export const MUSIC_PREF_KEY = 'tiu-presentation-music'
