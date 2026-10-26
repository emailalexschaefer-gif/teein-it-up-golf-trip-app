// Package 1 correction (26 Oct) -- media-ready playback.
//
// Root cause of "caption first, photo seconds later, photo on screen for half its time":
//  * the auto-advance timer started the instant the slide index changed, whether or not the
//    slide's picture had loaded, so a slow image used up the viewing time;
//  * only a neighbouring plain photo slide was preloaded -- winner, champion and group-photo
//    slides were not, and their text was drawn immediately, before the picture;
//  * the photo layers had no identity, so React re-used one <img> and showed the PREVIOUS
//    picture under the NEXT caption until the new one arrived.
//
// This module is the small, framework-free part of the fix: which image a slide needs, a
// loader that tracks ready / failed / timed-out per URL, and the "slide with its image removed"
// fallback. The player decides nothing about readiness itself.
import type { Slide } from '@/lib/trips/slideshowDeck'

/** A viewer who has reached a slide waits this long for its picture, then the slide shows its no-photo fallback. */
export const MEDIA_TIMEOUT_MS = 10000
/** Slides ahead whose pictures are fetched while the current one is on screen. */
export const PRELOAD_AHEAD = 2

export type MediaStatus = 'loading' | 'ready' | 'failed'

/** The one picture this slide must show before it can be revealed (null = nothing to wait for). */
export function requiredImageUrl(slide: Slide | undefined): string | null {
  if (!slide) return null
  switch (slide.kind) {
    case 'photo': return slide.imageUrl
    case 'groupPhoto': return slide.imageUrl
    case 'sideGameWinner': return slide.winnerImageUrl
    case 'champion': return slide.photoUrl
    case 'blooper': return slide.mediaType === 'photo' ? slide.imageUrl : null // a video has its own playback logic
    default: return null
  }
}

/** The same slide with its picture removed, so the template's existing no-photo layout is used. */
export function withoutImage(slide: Slide): Slide {
  switch (slide.kind) {
    case 'photo': return { ...slide, imageUrl: null }
    case 'groupPhoto': return { ...slide, imageUrl: null }
    case 'sideGameWinner': return { ...slide, winnerImageUrl: null }
    case 'champion': return { ...slide, photoUrl: null }
    case 'blooper': return slide.mediaType === 'photo' ? { ...slide, imageUrl: null } : slide
    default: return slide
  }
}

/** The urls to fetch ahead of `index`. */
export function urlsToPreload(slides: Slide[], index: number, ahead: number = PRELOAD_AHEAD): string[] {
  const out: string[] = []
  for (let i = index + 1; i <= index + ahead && i < slides.length; i++) {
    const u = requiredImageUrl(slides[i]); if (u && !out.includes(u)) out.push(u)
  }
  return out
}

export class SlideMediaLoader {
  private status = new Map<string, MediaStatus>()
  private disposed = false
  constructor(private load: (url: string) => Promise<void>, private onChange: () => void) {}

  /** null = never requested. */
  statusOf(url: string): MediaStatus | null { return this.status.get(url) ?? null }

  /** Start fetching once. `retry` restarts a failed url (used when a viewer comes back to that slide). */
  request(url: string, retry = false): void {
    if (this.disposed) return
    const cur = this.status.get(url)
    if (cur === 'loading' || cur === 'ready') return
    if (cur === 'failed' && !retry) return
    this.status.set(url, 'loading')
    this.load(url).then(() => this.settle(url, 'ready'), () => this.settle(url, 'failed'))
  }

  /** The viewer has waited long enough for this picture: show the fallback. A late arrival is ignored. */
  giveUp(url: string): void { this.settle(url, 'failed') }

  private settle(url: string, next: MediaStatus) {
    if (this.disposed || this.status.get(url) !== 'loading') return // already settled: a late result never changes a slide that has moved on
    this.status.set(url, next)
    this.onChange()
  }

  dispose() { this.disposed = true }
}

/** Browser loader: fetch and decode so the visible <img> can paint with no flash. */
export function browserImageLoad(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => { (typeof im.decode === 'function' ? im.decode().catch(() => undefined) : Promise.resolve()).then(() => resolve()) }
    im.onerror = () => reject(new Error('image failed'))
    im.src = url
  })
}

/**
 * Is the slide's content allowed on screen (and its timer allowed to run)?
 * No picture needed, or the picture is ready, or it failed / timed out (fallback shown).
 * A picture that has not even been requested yet counts as still loading -- never a flash of text.
 */
export function contentReady(url: string | null, status: MediaStatus | null): boolean {
  if (!url) return true
  return status === 'ready' || status === 'failed'
}
