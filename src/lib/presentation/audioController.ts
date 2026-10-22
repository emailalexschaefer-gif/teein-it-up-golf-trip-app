// Presentation audio controller: background music, video priority and the
// Overall Champion celebration. Framework- and DOM-free so the rules can be
// unit tested; the browser pieces (HTMLAudio / WebAudio) are supplied as
// AudioChannel objects.
//
// Rules enforced here:
//  * exactly ONE music channel and ONE applause channel -- never overlapping
//  * music continues across slides (never restarted; pause/resume keeps position)
//  * music only starts from an explicit start()/unlock() (user gesture)
//  * music is audible only when enabled AND no hold is active. Holds: 'video'
//    (audible video playing) and 'champion' (the whole time the viewer is on the
//    Overall Champion slide -- music is NOT restored when the applause ends,
//    only when the viewer leaves the slide)
//  * confetti is started by onReveal() at the moment applause genuinely begins
//    playing (or, with no applause, at the reveal moment) -- never before the
//    soundtrack has stopped
//  * every delayed callback is tied to a generation number, so a late callback
//    from an earlier visit can never act on a later slide

export interface AudioChannel {
  readonly playing: boolean
  /** Length of the loaded clip in ms, or null until metadata is known. */
  durationMs(): number | null
  play(): Promise<void>
  pause(): void
  rewind(): void
  setVolume(v: number): void
  setLoop(on: boolean): void
  /** Fires when playback has genuinely started. */
  onPlaying(cb: () => void): void
  dispose(): void
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(h: unknown): void
}

export interface AudioControllerOptions {
  music: AudioChannel
  applause: AudioChannel | null
  scheduler: Scheduler
  musicVolume: number
  /** Music fade to silence (video / champion). */
  fadeOutMs: number
  /** Music fade back in. */
  fadeInMs: number
  /** Pause after the champion slide appears, once the music has stopped, before applause + confetti. */
  revealDelayMs: number
  /** Used when the applause clip's duration is unknown, or there is no applause. */
  fallbackCelebrationMs: number
  confettiMinMs: number
  confettiMaxMs: number
  musicEnabled?: boolean
  applauseEnabled?: boolean
  /** Called once per celebration when applause has begun (or, without applause, at the reveal): start confetti for `confettiMs`. */
  onReveal?: (confettiMs: number) => void
}

export interface AudioState { musicEnabled: boolean; applauseEnabled: boolean; blocked: boolean; applauseAvailable: boolean }
type Hold = 'video' | 'champion'
const STEP_MS = 50
/** If applause neither starts nor fails within this time, celebrate visually anyway. */
const APPLAUSE_START_TIMEOUT_MS = 3000

export class PresentationAudioController {
  private o: AudioControllerOptions
  private started = false
  private disposed = false
  private musicEnabled: boolean
  private applauseEnabled: boolean
  private blocked = false
  private holds = new Set<Hold>()
  private level = 0
  private fadeTimer: unknown = null
  private celebTimers: unknown[] = []
  private gen = 0
  private awaitingApplause = false
  private listeners = new Set<(s: AudioState) => void>()

  constructor(options: AudioControllerOptions) {
    this.o = options
    this.musicEnabled = options.musicEnabled ?? true
    this.applauseEnabled = options.applauseEnabled ?? true
    options.music.setLoop(true)
    options.music.setVolume(0)
    options.applause?.setLoop(false)
    options.applause?.onPlaying(() => this.onApplausePlaying())
  }

  getState(): AudioState {
    return { musicEnabled: this.musicEnabled, applauseEnabled: this.applauseEnabled, blocked: this.blocked, applauseAvailable: this.o.applause !== null }
  }
  subscribe(fn: (s: AudioState) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { const s = this.getState(); this.listeners.forEach(fn => fn(s)) }

  private target(): number { return this.musicEnabled && this.holds.size === 0 ? this.o.musicVolume : 0 }

  /** Call from a user gesture. Safe to call repeatedly (never creates a second playback). */
  async start(): Promise<void> {
    if (this.disposed) return
    this.started = true
    await this.syncMusic()
  }

  /** Call from any later user gesture to retry if the browser blocked the first attempt. */
  async unlock(): Promise<void> {
    if (this.disposed || !this.started) return
    if (this.blocked || (this.target() > 0 && !this.o.music.playing)) await this.syncMusic()
  }

  setMusicEnabled(on: boolean): void {
    if (this.disposed || this.musicEnabled === on) return
    this.musicEnabled = on
    this.emit()
    void this.syncMusic()
  }

  /** Celebration sound on/off. Switching off mid-celebration stops the applause but keeps the music held until the viewer leaves the slide. */
  setApplauseEnabled(on: boolean): void {
    if (this.disposed || this.applauseEnabled === on) return
    this.applauseEnabled = on
    if (!on) this.stopApplause()
    this.emit()
  }

  /** Audible video playing (true) / finished, paused or muted (false). */
  setVideoPlaying(on: boolean): void {
    if (this.disposed) return
    this.setHold('video', on)
  }

  /** Overall Champion slide entered. */
  celebrate(): void {
    if (this.disposed) return
    this.cancelPending()
    this.stopApplause()
    const gen = ++this.gen
    this.setHold('champion', true) // music fades to silence and pauses; stays that way for the whole slide
    this.celebTimers.push(this.o.scheduler.setTimeout(() => this.reveal(gen), this.o.revealDelayMs))
  }

  /** Champion slide left (or presentation closing): stop applause, clear pending work, bring the music back. */
  endCelebration(): void {
    this.gen += 1
    this.cancelPending()
    this.stopApplause()
    this.setHold('champion', false)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true // first, so stopping the celebration cannot restart the music
    this.gen += 1
    this.cancelPending()
    this.stopApplause()
    if (this.fadeTimer !== null) this.o.scheduler.clearInterval(this.fadeTimer)
    this.fadeTimer = null
    this.o.music.pause()
    this.o.music.dispose()
    this.o.applause?.dispose()
    this.listeners.clear()
  }

  // ---- celebration internals ----
  private reveal(gen: number) {
    if (gen !== this.gen || this.disposed) return
    const a = this.o.applause
    if (!a || !this.applauseEnabled) { this.o.onReveal?.(this.o.fallbackCelebrationMs); return }
    this.awaitingApplause = true
    a.rewind()
    a.play().catch(() => {
      if (gen !== this.gen || !this.awaitingApplause) return
      this.awaitingApplause = false
      this.o.onReveal?.(this.o.fallbackCelebrationMs) // blocked/failed applause: visual celebration only, nothing stuck
    })
    this.celebTimers.push(this.o.scheduler.setTimeout(() => {
      if (gen !== this.gen || !this.awaitingApplause) return
      this.awaitingApplause = false
      this.o.onReveal?.(this.o.fallbackCelebrationMs)
    }, APPLAUSE_START_TIMEOUT_MS))
  }

  private onApplausePlaying() {
    if (!this.awaitingApplause || this.disposed) return // stale or duplicate event
    this.awaitingApplause = false
    const d = this.o.applause?.durationMs() ?? null
    const ms = d === null ? this.o.fallbackCelebrationMs : Math.min(this.o.confettiMaxMs, Math.max(this.o.confettiMinMs, d))
    this.o.onReveal?.(ms)
  }

  private cancelPending() {
    this.celebTimers.forEach(h => this.o.scheduler.clearTimeout(h))
    this.celebTimers = []
    this.awaitingApplause = false
  }

  private stopApplause() {
    this.awaitingApplause = false
    if (this.o.applause) { this.o.applause.pause(); this.o.applause.rewind() }
  }

  private setHold(h: Hold, on: boolean) {
    if (on === this.holds.has(h)) return
    if (on) this.holds.add(h); else this.holds.delete(h)
    void this.syncMusic()
  }

  // ---- music internals ----
  private async syncMusic(): Promise<void> {
    if (!this.started || this.disposed) return
    const target = this.target()
    if (target > 0 && !this.o.music.playing) {
      try {
        await this.o.music.play()
        if (this.blocked) { this.blocked = false; this.emit() }
      } catch {
        if (!this.blocked) { this.blocked = true; this.emit() }
        return
      }
      if (this.disposed || this.target() === 0) { this.fadeTo(0); return } // a hold arrived while play() was pending
    }
    this.fadeTo(target)
  }

  private fadeTo(target: number) {
    if (this.fadeTimer !== null) { this.o.scheduler.clearInterval(this.fadeTimer); this.fadeTimer = null }
    const ms = target < this.level ? this.o.fadeOutMs : this.o.fadeInMs
    if (ms <= 0 || this.level === target) { this.setLevel(target); return }
    const steps = Math.max(1, Math.round(ms / STEP_MS))
    const from = this.level
    let i = 0
    this.fadeTimer = this.o.scheduler.setInterval(() => {
      i += 1
      this.setLevel(from + ((target - from) * i) / steps)
      if (i >= steps) {
        if (this.fadeTimer !== null) this.o.scheduler.clearInterval(this.fadeTimer)
        this.fadeTimer = null
        this.setLevel(target)
      }
    }, STEP_MS)
  }

  private setLevel(v: number) {
    this.level = v
    this.o.music.setVolume(v)
    // Fully faded out (muted / video / champion): pause so video audio and the applause have the
    // output to themselves. Resuming continues from the same position (never restarts).
    if (v === 0 && this.target() === 0 && this.o.music.playing) this.o.music.pause()
  }
}
