import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * 15 Oct -- iPhone "Next is hidden" bug in Create Slideshow -> Choose
 * Sections (reported by Darren). Static-source checks, per this repo's
 * convention for client components (no DOM harness). The behaviour itself
 * was also checked by rendering the real page in headless Chromium with
 * simulated iPhone insets (see the delivery report).
 *
 * Root cause: wizard screens were `fixed; inset: 0` at z-index 60/65 with
 * the primary action in a header that had no safe-area padding, while the
 * mobile TripBottomNav (fixed, z-index 100) painted over the bottom of
 * every wizard screen; layout.tsx uses viewportFit 'cover' + a
 * black-translucent status bar.
 */
const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(resolve(here, '../../app/(app)/trips/[tripId]/memories/page.tsx'), 'utf8')
const nav = readFileSync(resolve(here, '../../components/layout/TripBottomNav.tsx'), 'utf8')

const navZ = Number(nav.match(/zIndex: (\d+)/)![1])
const wizardZ = Number(page.match(/const WIZARD_Z = (\d+)/)![1])

test('wizard layers sit above the persistent mobile bottom nav', () => {
  assert.ok(wizardZ > navZ, `wizard z-index ${wizardZ} must exceed TripBottomNav ${navZ}`)
})

test('no wizard screen still uses the old inset:0 / z-index 60|65 overlay styles', () => {
  assert.ok(!/position: 'fixed', inset: 0, background: '#fff', zIndex: 6[05]/.test(page))
  assert.ok(!/position: 'fixed', inset: 0, background: 'rgba\(0,0,0,0\.6\)', zIndex: 60/.test(page))
})

test('full-screen wizard uses the dynamic viewport with a bottom:0 fallback', () => {
  const m = page.match(/const wizardScreenStyle[\s\S]*?\n\}/)![0]
  assert.match(m, /bottom: 0/)
  assert.match(m, /height: '100dvh'/)
  assert.match(m, /zIndex: WIZARD_Z/)
})

test('header clears the status bar / Dynamic Island, footer clears the home indicator', () => {
  assert.match(page.match(/const wizardHeaderStyle[\s\S]*?\n\}/)![0], /env\(safe-area-inset-top/)
  assert.match(page.match(/const wizardFooterStyle[\s\S]*?\n\}/)![0], /env\(safe-area-inset-bottom/)
  assert.match(page.match(/const wizardSheetStyle[\s\S]*?\n\}/)![0], /env\(safe-area-inset-bottom/)
})

test('the section list scrolls on its own, between a fixed header and footer', () => {
  const b = page.match(/const wizardBodyStyle[\s\S]*?\n\}/)![0]
  assert.match(b, /flex: 1/)
  assert.match(b, /minHeight: 0/)
  assert.match(b, /overflowY: 'auto'/)
  assert.match(b, /overscrollBehavior: 'contain'/)
  assert.match(page.match(/const wizardFooterStyle[\s\S]*?\n\}/)![0], /flexShrink: 0/)
})

test('bottom sheets are capped to the dynamic viewport and scroll internally', () => {
  const s = page.match(/const wizardSheetStyle[\s\S]*?\n\}/)![0]
  assert.match(s, /maxHeight: '85dvh'/)
  assert.match(s, /overflowY: 'auto'/)
})

test('primary buttons meet the 44px iOS tap-target minimum', () => {
  assert.match(page.match(/const wizardPrimaryBtn[\s\S]*?\n\}/)![0], /minHeight: 4[4-9]/)
  assert.match(page.match(/const wizardSecondaryBtn[\s\S]*?\n\}/)![0], /minHeight: 44/)
})

const sections = page.slice(page.indexOf("slideshowStep === 'sections'"), page.indexOf('Step 3 -- Review'))

test('Choose Sections: Next lives in the footer and still goes to review; Cancel still closes', () => {
  assert.match(sections, /<div style=\{wizardFooterStyle\}>[\s\S]*setSlideshowStep\('closed'\)[\s\S]*Cancel[\s\S]*setSlideshowStep\('review'\)\} style=\{wizardPrimaryBtn\}>Next</)
  assert.ok(!/background: '#1a4731'[^}]*>Next</.test(sections), 'no header Next with the old inline style should remain')
})

test('Review: Back and Play are in the footer with unchanged handlers', () => {
  const review = page.slice(page.indexOf("slideshowStep === 'review'"), page.indexOf('Step 4 -- fullscreen'))
  assert.match(review, /<div style=\{wizardFooterStyle\}>[\s\S]*setSlideshowStep\('sections'\)[\s\S]*Back[\s\S]*onClick=\{playPresentation\} style=\{wizardPrimaryBtn\}>▶ Play</)
})

test('Choose Memories and the aftershow picker keep their Back/Done handlers, now in footers', () => {
  const cm = page.slice(page.indexOf("slideshowStep === 'chooseMemories'"), page.indexOf('Step 3 -- Choose Sections'))
  assert.match(cm, /setSlideshowStep\('memories'\)\} style=\{wizardSecondaryBtn\}>Back/)
  assert.match(cm, /setSlideshowStep\('sections'\)\} style=\{wizardPrimaryBtn\}>Done/)
  assert.match(page, /setShowAftershowPicker\(false\)\} style=\{wizardPrimaryBtn\}>Done/)
})

test('slideshow logic is untouched: handlers and deck builders still referenced exactly as before', () => {
  assert.equal((page.match(/buildPresentationDeck\(/g) ?? []).length, 2) // import-free call sites: preview + playPresentation
  assert.match(page, /getAvailableSections\(manifest, presentationConfig\.scope\)/)
})

// 17 Oct: this used to pin the Group/Champion pickers at z-index 70 as "out of
// scope". That was the bug - at 70 they sit BELOW the bottom nav (100), which hid
// the champion picker's Save button. They now share WIZARD_Z (see below).
test('Group / Champion pickers are no longer left on their old z-index 70', () => {
  assert.equal((page.match(/zIndex: 70/g) ?? []).length, 0)
})

// ── 17 Oct follow-up: the same bottom-nav overlap on the rest of the page ──
// Darren's "Which Memories should we include?" screenshot is the pre-fix build
// (Choose Memories, the last option, under the nav). These pin the rest of the
// shared contract: EVERY fixed overlay on the Memories page and the slideshow
// player sits above the mobile bottom nav and clears the home indicator.

const player = readFileSync(resolve(here, '../../components/memories/EventHighlightsPlayer.tsx'), 'utf8')

test('no fixed overlay on the Memories page uses a literal z-index below the bottom nav', () => {
  const lits = [...page.matchAll(/position: 'fixed'[^}]*?zIndex: (\d+)/g)].map(m => Number(m[1]))
  assert.deepEqual(lits, [], `literal z-index values found: ${lits.join(',')} - use WIZARD_Z`)
  assert.ok(!/zIndex: (50|60|65|70)\b/.test(page), 'old 50/60/65/70 overlay layers are gone')
})

test('photo lightbox shares the wizard layer, dynamic viewport and safe-area padding', () => {
  const l = page.match(/const wizardLightboxStyle[\s\S]*?\n\}/)![0]
  assert.match(l, /zIndex: WIZARD_Z/)
  assert.match(l, /height: '100dvh'/)
  assert.match(l, /env\(safe-area-inset-bottom/)
  assert.match(l, /env\(safe-area-inset-top/)
  const use = page.slice(page.indexOf('{/* Detail lightbox */}'), page.indexOf('{/* Detail lightbox */}') + 700)
  assert.match(use, /style=\{wizardLightboxStyle\}/)
  assert.match(use, /overflowY: 'auto', maxHeight: '100%'/, 'a tall photo scrolls inside the card instead of running off screen')
  assert.match(page, /downloadOne\(detailMoment\.momentId\)/, 'Download action unchanged')
  assert.match(page, /Add to Aftershow/, 'Add to Aftershow action unchanged')
})

test('Group Photo and Champion Photo pickers use the shared backdrop and clear the home indicator', () => {
  const group = page.slice(page.indexOf('{showGroupPhotoPicker && ('), page.indexOf('Champion Photo picker -- V1.6'))
  assert.match(group, /onClick=\{\(\) => setShowGroupPhotoPicker\(false\)\} style=\{wizardBackdropStyle\}/)
  assert.match(group, /calc\(20px \+ env\(safe-area-inset-bottom, 0px\)\)/)
  assert.match(group, /maxHeight: '75dvh'/)
  assert.match(group, /setGroupPhoto\(m\.momentId\)/, 'selection handler unchanged')
  const champ = page.slice(page.indexOf('Champion Photo picker -- V1.6'), page.indexOf('const wizardBackdropStyle') > 0 ? page.indexOf('showChampionPhotoPicker && (() => {') + 6000 : undefined)
  assert.match(champ, /onClick=\{\(\) => setShowChampionPhotoPicker\(false\)\} style=\{wizardBackdropStyle\}/)
  assert.match(champ, /padding: '12px 20px calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\)'/, 'Save/Cancel bar clears the home indicator')
  assert.match(champ, />\s*Save\s*</)
  assert.match(champ, />\s*Cancel\s*</)
})

test('Event Highlights player sits above the mobile bottom nav (equal z-index let the later nav paint over it)', () => {
  const pz = Number(player.match(/const PLAYER_Z = (\d+)/)![1])
  assert.ok(pz > navZ, `player z-index ${pz} must exceed TripBottomNav ${navZ}`)
  assert.match(player, /zIndex: PLAYER_Z/)
  assert.ok(!/zIndex: 100\b/.test(player), 'no literal z-index equal to the nav remains')
})

test('every wizard step still uses the shared screen/sheet styles (scope, memories, chooseMemories, sections, review)', () => {
  const body = page.slice(page.indexOf("slideshowStep === 'scope'"), page.indexOf("slideshowStep === 'playing'"))
  assert.equal((body.match(/style=\{wizardBackdropStyle\}/g) ?? []).length, 2, 'scope + memories sheets')
  assert.equal((body.match(/style=\{wizardSheetStyle\}/g) ?? []).length, 2)
  assert.ok((body.match(/style=\{wizardScreenStyle\}/g) ?? []).length >= 3, 'chooseMemories + sections + review full screens')
  assert.match(body, /Choose Memories<\/span>/, 'Choose Memories option present')
  assert.match(body, /chooseBestMomentsSource\('favourites'\)/)
  assert.match(body, /chooseBestMomentsSource\('all'\)/)
})
