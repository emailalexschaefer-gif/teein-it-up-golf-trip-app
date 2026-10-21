import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, existsSync } from 'node:fs'

// Phase A (performance) — pins the static-asset, caching and lazy-loading
// changes so they can't silently regress, and pins what must NOT change.

const root = new URL('../../../', import.meta.url)
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8')
const size = (rel: string) => statSync(new URL(rel, root)).size

test('A-4: optimised crest files exist, are small, and the original is left in place', () => {
  assert.ok(existsSync(new URL('public/brand/logo-new-960.webp', root)))
  assert.ok(existsSync(new URL('public/brand/logo-new-720.png', root)))
  assert.ok(size('public/brand/logo-new-960.webp') < 250_000, 'WebP should be ~200 KB or less')
  assert.ok(size('public/brand/logo-new-720.png') < 800_000, 'PNG fallback well under the 1.7 MB original')
  assert.ok(size('public/brand/logo-new.png') > 1_500_000, 'original logo-new.png untouched (fallback / rollback)')
})

test('A-4: optimised files are real WebP / PNG (magic bytes)', () => {
  const webp = readFileSync(new URL('public/brand/logo-new-960.webp', root))
  assert.equal(webp.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(webp.subarray(8, 12).toString('ascii'), 'WEBP')
  const png = readFileSync(new URL('public/brand/logo-new-720.png', root))
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
})

test('A-4: BrandLogo serves WebP with a PNG fallback inside the same <img>, keeping the text fallback', () => {
  const src = read('src/components/brand/BrandLogo.tsx')
  assert.ok(src.includes("const LOGO_FULL_WEBP = '/brand/logo-new-960.webp'"))
  assert.ok(src.includes("const LOGO_FULL_PNG = '/brand/logo-new-720.png'"))
  assert.ok(src.includes('<source srcSet={LOGO_FULL_WEBP} type="image/webp" />'))
  assert.ok(src.includes('onError={() => setFailed(true)}'), 'text fallback retained')
  assert.ok(src.includes('width={720}') && src.includes('height={720}'), 'dimensions reserve space (no layout shift)')
  assert.ok(src.includes("loading={priority ? 'eager' : 'lazy'}"), 'priority behaviour unchanged')
  assert.ok(src.includes("fetchPriority={priority ? 'high' : 'auto'}"))
  assert.ok(src.includes("icon: { src: '/brand/teein-it-up-icon.png'"), 'icon variant unchanged')
})

test('A-3: cache headers are limited to /brand and /images, are not immutable, and never cover sw.js or the manifest', () => {
  const cfg = read('next.config.ts')
  assert.ok(cfg.includes("source: '/brand/:path*'"))
  assert.ok(cfg.includes("source: '/images/:path*'"))
  assert.ok(cfg.includes('public, max-age=86400, stale-while-revalidate=604800'))
  assert.equal(/immutable/.test(cfg.replace(/\/\/.*$/gm, '')), false, 'no immutable caching on non-hashed URLs')
  const headersBlock = cfg.slice(cfg.indexOf('async headers()'), cfg.indexOf('typescript:'))
  assert.equal(/sw\.js|manifest\.json|\/api\//.test(headersBlock.replace(/\/\/.*$/gm, '')), false)
})

test('A-5: noncritical thumbnails/avatars are lazy; slideshow player and immediately-visible media are untouched', () => {
  const lazy: [string, number][] = [
    ['src/components/scoring/LiveLeaderboard.tsx', 2],
    ['src/components/scoring/TournamentControl.tsx', 2],
    ['src/components/scoring/PlayerRoundView.tsx', 1],
    ['src/components/scoring/StartingGrid.tsx', 1],
    ['src/components/scoring/TheField.tsx', 1],
    ['src/app/(app)/trips/[tripId]/PlayerHomeCard.tsx', 1],
    ['src/components/trips/TripCard.tsx', 1],
    ['src/app/(app)/trips/[tripId]/memories/page.tsx', 1],
    ['src/components/chat/EventMessages.tsx', 1],
  ]
  for (const [f, n] of lazy) {
    const count = (read(f).match(/loading="lazy"/g) ?? []).length
    assert.ok(count >= n, `${f}: expected >= ${n} lazy images, got ${count}`)
  }
  // Presentation behaviour must be unchanged: no lazy/async attributes added to the player.
  const player = read('src/components/memories/EventHighlightsPlayer.tsx')
  assert.equal(/loading="lazy"|decoding="async"/.test(player), false)
  // Immediately-visible images are not lazy.
  assert.equal(/loading="lazy"/.test(read('src/components/moments/MomentViewer.tsx')), false)
  assert.equal(/loading="lazy"/.test(read('src/components/layout/AppNav.tsx')), false)
  assert.equal(/loading="lazy"/.test(read('src/components/shared/PlayerCardModal.tsx')), false)
})

test('A-5: avatars that gained explicit dimensions match their CSS size', () => {
  const lb = read('src/components/scoring/LiveLeaderboard.tsx')
  assert.ok(/width=\{32\} height=\{32\}[\s\S]{0,60}style=\{\{ width: 32, height: 32/.test(lb))
  assert.ok(/width=\{24\} height=\{24\}[\s\S]{0,60}style=\{\{ width: 24, height: 24/.test(lb))
})

test('Phase A does not touch scoring write/sync code', () => {
  for (const f of ['src/app/api/scores/route.ts', 'src/lib/scoring/recordedResend.ts', 'src/lib/scoring/resumeHole.ts']) {
    assert.equal(/withServerTiming|loading="lazy"|SignedUrlCache/.test(read(f)), false, f)
  }
})
