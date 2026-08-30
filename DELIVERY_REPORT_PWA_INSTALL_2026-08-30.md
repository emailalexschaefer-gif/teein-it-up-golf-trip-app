# PWA INSTALLATION BUG — SAMSUNG/ANDROID
## Delivery Report — 30 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. All TypeScript
files touched were syntax-checked directly — **zero errors**. The
service worker itself (`public/sw.js`, plain JS, runs in a browser
worker context, not Node/Next.js) was checked with `node -c` for valid
syntax. Full pure-function suite re-confirmed unaffected: **310/310
pass**. Nothing here touches scoring/business logic.

---

## Root cause — audited per your exact checklist, two independent bugs found

### 1. No service worker existed anywhere in the project

Checked items 1–5 of your list first, since the manifest was the most
likely suspect:

- **Manifest valid and served:** yes — `public/manifest.json` is
  well-formed JSON with correct `name`, `short_name`, `start_url`,
  `scope`, `display: "standalone"`, `theme_color`, `background_color`.
- **Icons present and correct:** yes — `icon-192.png` and
  `icon-512.png` are valid PNGs at the declared dimensions, and are
  genuinely the real Teein' It Up crest artwork (verified visually,
  not assumed).
- **Manifest correctly linked from Next.js metadata:** yes —
  `src/app/layout.tsx`'s `metadata.manifest = '/manifest.json'`,
  correctly wired.

All five of those checked out — the manifest was never the problem.

**Item 6 is where the actual root cause was found:** there is no
service worker anywhere in this project — no manual `sw.js`, no
`next-pwa`/Workbox plugin in `next.config.ts`, no registration code
anywhere in `src/`. A correct manifest alone is **not** sufficient for
Chrome on Android to offer the real "Install" experience — a
registered service worker with a `fetch` handler is part of Chrome's
own installability criteria. Without one, Chrome correctly determines
the site doesn't qualify and falls back to "Create shortcut" — which
does **not** use the manifest's icons at all, which is the actual,
complete explanation for the generic grey icon. This was never a
manifest or icon-file problem; both were already correct.

### 2. Middleware was blocking the manifest, service worker, and icons for anyone not yet logged in

While tracing this, checked whether `manifest.json`/`sw.js`/icon
requests could even reach the browser cleanly — and found a second,
independent bug in `src/middleware.ts`. Its `isPublic` allowlist
(routes an unauthenticated visitor can reach without being redirected
to `/login`) did not include `/manifest.json`, `/sw.js`, or
`/brand/*`. Chrome's manifest and service-worker fetches happen
automatically and unauthenticated — for anyone who hasn't logged in
yet, every one of these requests was silently redirected to the login
page instead of returning the actual file. This specifically breaks
installability during the exact moment your own brief describes as
the goal: *"Darren sends someone an invitation, they join, Teein' It
Up prompts them to Install"* — that's before or during their first
login, precisely the window this bug affected. (This wouldn't have
been the blocker for Darren's own on-device test, since he was almost
certainly already logged in — the missing service worker, above, is
what explains that specific symptom. Both bugs are real and both
needed fixing for the full described experience.)

---

## Fix

- **`public/sw.js` (new)** — a genuinely minimal, conservative service
  worker. Given this is a live-scoring app, it deliberately caches
  **only** static assets (`/brand/*`, `/manifest.json`, favicons) with
  a cache-first strategy; every navigation and every `/api/*` request
  passes straight through to the network, always, untouched — no
  offline shell, no stale-while-revalidate for anything that could
  show outdated scores, leaderboards, or event data. This is the
  minimum real implementation that satisfies Chrome's installability
  requirement without introducing any staleness risk.
- **`src/components/pwa/ServiceWorkerInit.tsx` (new)** + wired into
  `src/app/layout.tsx` — registers it once, at the true app root, same
  pattern already established for `InstallPromptCaptureInit`.
- **`src/middleware.ts`** — added `/manifest.json`, `/sw.js`, and
  `/brand/` to the public allowlist.
- **`public/manifest.json`** — added a dedicated maskable icon entry
  (see below); the two existing `purpose: "any"` icons are unchanged.
- **`public/brand/icon-512-maskable.png` (new)** — the existing
  512×512 icon has artwork running edge-to-edge with no safe-zone
  margin, which is fine for `purpose: "any"` but genuinely unsafe to
  reuse directly as a maskable icon: Android can apply a circular or
  other mask shape to a maskable icon, and would clip the existing
  icon's outer border/banner. Built a dedicated maskable variant —
  same real logo artwork, scaled to sit within Android's ~80% safe
  zone on a full-bleed background in the app's own theme color
  (`#0f2d1c`), so no mask shape can clip any part of the crest.
  Verified visually, not assumed.

## What this does NOT change

- No new "Add to Home Screen" UI was built. `InstallPwaCard.tsx` (from
  an earlier round) already correctly calls the genuine native
  `deferredPrompt.prompt()` API when `beforeinstallprompt` has fired —
  this **is** the proper install flow already, not a fallback
  shortcut. It simply never had a genuinely installable site to work
  with. Per your own instruction to "wire the existing Lobby onboarding
  into this proper install flow" — that wiring already existed and is
  correctly designed; today's fix is what makes it actually able to
  fire.
- Nothing about login, session handling, or any protected route's
  behaviour changed — the middleware fix only widens the *public*
  allowlist for three specific static paths needed for installability
  detection itself.

## FILES CHANGED

- `public/sw.js` (new)
- `public/manifest.json` (maskable icon entry added)
- `public/brand/icon-512-maskable.png` (new)
- `src/components/pwa/ServiceWorkerInit.tsx` (new)
- `src/app/layout.tsx` (registers the above)
- `src/middleware.ts` (public allowlist)

## MIGRATIONS REQUIRED: No.

## TESTS

No new automated tests — this is browser-platform PWA
configuration/registration, not application logic suited to the
existing pure-function suite. Full existing suite re-confirmed
unaffected: **310/310 pass.**

---

## What I could verify vs. what genuinely needs your device

**Verified directly, not assumed:**
- `manifest.json` is valid JSON (parsed and re-serialized to confirm).
- `sw.js` is syntactically valid JavaScript.
- Both icon files are valid, correctly-sized PNGs, and are genuinely
  the real Teein' It Up artwork (opened and visually inspected).
- The maskable icon was rendered and visually inspected — the logo
  sits centered with clear margin, not touching any edge.
- Every file above is present in this delivered package at the
  correct path (same explicit verification approach as the logo fix:
  checked directly, not assumed).

**Cannot verify from this sandbox — needs your device, per your own
acceptance test:**
- Whether Chrome on your Samsung device now actually offers "Install"
  instead of only "Create shortcut" — this depends on Chrome's live
  installability evaluation against the *deployed* site, which needs
  your actual Vercel deployment, not this local package.
- Whether the installed icon renders correctly (no grey fallback,
  crest fully visible, no clipping from the maskable mask).
- Standalone launch (no address bar), existing login/session surviving
  into the installed app, and deep/event links working from within it.
- Per your own item 8 — **confirm this repo's `public/sw.js` and
  `public/manifest.json` changes actually reach the live Vercel build**,
  not just this sandbox's copy. This has been the actual root cause of
  more than one branding/asset issue in this project already (see
  `BrandLogo.tsx`'s own long-standing comment about files present on
  disk but never committed) — worth treating as a real risk here too,
  not a formality.

I have not claimed the Samsung install experience now works — only that
I found and fixed two real, independent, previously-undiscovered
structural bugs (missing service worker; middleware blocking the
manifest/service-worker/icons for logged-out visitors) that together
explain the reported symptom completely. The acceptance test in your
brief is what actually closes this out.
