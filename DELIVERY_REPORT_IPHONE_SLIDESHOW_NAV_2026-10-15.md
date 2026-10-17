# iPhone Slideshow Navigation Bug — Delivery Report (15 Oct 2026)

Reported by Darren: Create Slideshow → Choose Sections, Next is obscured on iPhone. **Not deployed.**

## Root cause
Inferred from the code and a simulated-inset render. **Not yet confirmed on real iPhone hardware.**

1. The wizard screens were `position: fixed; inset: 0` at z-index 60/65. The mobile `TripBottomNav` is fixed at z-index 100, so it painted **over the bottom of every wizard screen** and hid the last rows of the lists.
2. `layout.tsx` sets `viewportFit: 'cover'` and a `black-translucent` status bar, but the wizard had **no `env(safe-area-inset-*)` padding**. Next sat in a header 16px from the top, which on an iPhone puts it under the status bar / Dynamic Island, where taps go to the system. In the simulated render it sat at y 23–51 inside a 47px inset.
3. Sizing relied on `inset: 0` alone, with no dynamic-viewport handling.

Note: in the old code Next was in the **top** header, not the bottom. Darren's "bottom" description matches the nav overlap and the unreachable controls. I could not reproduce the exact device, so please re-test on his iPhone (Safari and the installed PWA).

## Fix (one file, presentation-layout only)
`src/app/(app)/trips/[tripId]/memories/page.tsx`
- Shared wizard style constants replace the inline overlay styles on all six steps (scope, memories, chooseMemories, sections, review, aftershow picker).
- z-index 110, above the bottom nav.
- `height: 100dvh` with `bottom: 0` as the fallback.
- Header padded with `env(safe-area-inset-top)`.
- A **footer** padded with `env(safe-area-inset-bottom)` that holds the primary action. The list body is the only scrolling region (`minHeight: 0`, `overflow-y: auto`, `overscroll-behavior: contain`).
- Next / Done / Play moved from the header to the footer. Handlers are unchanged. Back or Cancel sits bottom-left in the same footer, and the header shows only the title.
- Buttons are at least 44–46px tall.
- The two bottom sheets get bottom-inset padding and `max-height: 85dvh` with internal scroll.
- Not touched: slideshow generation, deck builders, config state, the group-photo and champion pickers (z 70), and the other files.

Test file added: `src/lib/scoring/slideshowWizardIphoneLayout.test.ts` (12 tests).

## Verification
- Full suite: **947 / 947 pass** (935 baseline + 12 new).
- Real `page.tsx` bundled with esbuild and rendered in headless Chromium, with a mocked manifest, a stand-in bottom nav and iPhone insets simulated as top 47px / bottom 34px. Before vs after:

| Viewport | Before | After |
|---|---|---|
| iPhone 390x844, long list (5 rounds) | Next at y 23–51, inside the status-bar inset; bottom ~62px of the list under the nav | Next at y 754–800, clear of the 34px inset and above the nav; the list scrolls independently |
| iPhone 390x844, short list (1 round) | same as above | Footer pinned, no overlap |
| iPhone SE 375x667 | n/a | Next at y 611–657, visible |
| Android 412x915 | Next near the top | Footer visible; no clipping |
| Desktop 1280x800 | Next at top right | Footer visible; layout intact |

- Full flow in the after build: Create Slideshow → Full Event → All Memories → Choose Sections → toggle a section off → Next → review (35 slides, Play visible and in the safe area) → Back → the toggle is still off, so selections are preserved.
- Hit-test: the point at the centre of Next resolves to the Next button in every "after" case.

## Not verified
- **Real iPhone (Safari and PWA).** `env()` values were simulated, and a real dynamic toolbar was not.
- `tsc` / `next build`: unavailable in the sandbox. The syntax-only check on `page.tsx` is clean, so please confirm on the Vercel build.

## Mobile checklist for Darren
1. iPhone Safari: Create Slideshow → Full Event → Choose Sections. Next is visible bottom-right without scrolling.
2. Scroll to the bottom of the list with the toolbar showing and hiding. Closing / Thanks stays reachable.
3. Repeat in the installed PWA. Nothing sits under the status bar.
4. Next → Back keeps the toggles. Play opens the slideshow.
5. Check the bottom sheets (scope, "Which Memories…") on a long round list.
