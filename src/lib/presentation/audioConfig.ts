// Presentation audio configuration.
//
// MUSIC: "Funky Clubhouse Mix" -- an original generated instrumental,
// approved for use. Served as a static asset (no database storage, no signed links).
//
// APPLAUSE: the recovered V62 demo applause has NO established licence or
// provenance, so it is NOT shipped in this package and the feature is OFF.
// To enable later, once rights are cleared or a licensed replacement exists:
//   1. add the file as public/audio/celebration-applause.mp3
//   2. set NEXT_PUBLIC_PRESENTATION_APPLAUSE=on in Vercel and redeploy.
// With the flag off, no applause is requested or played anywhere.
export const MUSIC_SRC = '/audio/funky-clubhouse-mix.mp3'
export const APPLAUSE_SRC: string | null =
  process.env.NEXT_PUBLIC_PRESENTATION_APPLAUSE === 'on' ? '/audio/celebration-applause.mp3' : null

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
