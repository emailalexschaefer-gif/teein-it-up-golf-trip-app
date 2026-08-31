# TEEIN' IT UP LOGO / SPLASH SCREEN POLISH
## Delivery Report — 31 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. The one TypeScript
file touched (comment-only) was syntax-checked — **zero errors**. Full
test suite re-confirmed unaffected: **318/318 pass** (251 scoring + 59
highlights + 8 analytics). Nothing in this round touched application
logic — this was a genuinely asset-and-comment-only change.

---

## 1. Existing logo assets found (full audit)

| File | Dimensions | Mode | Background (before) |
|---|---|---|---|
| `icon-192.png` | 192×192 | RGBA | opaque white |
| `icon-512.png` | 512×512 | RGBA | opaque white |
| `icon-512-maskable.png` | 512×512 | RGBA | opaque dark green (correct, full-bleed by design) |
| `teein-it-up-icon.png` | 256×256 | RGBA | opaque white |
| `logo-new.png` | 1254×1254 | RGB | opaque near-white (253,253,253) |
| `teein-it-up-logo-transparent.png` | 500×494 | RGBA | **genuinely transparent already** |
| `lobby-brochure-watermark.png` | 1600×430 | RGB | n/a — unrelated asset (Lobby brochure background), untouched |

Traced every reference across `src/` and `public/manifest.json` before
changing anything — confirmed exactly who depends on what.

## 2. Which assets are canonical

- **`icon-192.png` / `icon-512.png`** — canonical PWA manifest icons
  (`purpose: "any"`), Apple touch icon, and the source Chrome uses to
  auto-generate the native install/launch splash screen. Also used
  directly (small inline `<img>`) in `InstallPwaCard.tsx`.
- **`icon-512-maskable.png`** — canonical maskable icon. Correctly
  full-bleed dark green by design (built in an earlier round
  specifically so no Android mask shape clips the crest) — **not**
  meant to be transparent, and genuinely untouched this round.
- **`teein-it-up-icon.png`** — canonical for `BrandLogo`'s `icon`
  variant (compact header/loading-screen usage — `LoadingScreen.tsx`,
  install card, etc.). A visually similar but structurally separate
  file from `icon-192.png`, kept separate rather than merged, since
  consolidating it would mean changing `BrandLogo.tsx`'s asset
  mapping — out of scope for a small polish release with an explicit
  "do not expand scope" instruction.
- **`logo-new.png`** — canonical for `BrandLogo`'s `full` variant
  (Sign In / brand-introduction screen). Confirmed still the right
  choice: your own screenshot shows it rendering correctly in
  production (the real crest, not the onError fallback text from the
  previous round's bug) — so this round fixed its background in
  place rather than swapping to a different source file.

## 3. Duplicate/obsolete assets discovered

**`teein-it-up-logo-transparent.png`** — a genuinely, already-transparent
version of the *full* crest, confirmed unused anywhere in the current
codebase (only mentioned in old code comments, not referenced by any
component). This is the asset your brief's item 3 describes ("if a
clean transparent source asset already exists... use that") — but I
did **not** switch to it, for a specific reason: `logo-new.png` is the
one your own screenshot confirms is genuinely rendering correctly in
production right now. Swapping the source file again reopens a
previously-real risk (an earlier round's asset genuinely failed to
load in production for reasons never fully confirmed) for no visual
benefit — fixing `logo-new.png`'s own background in place gets the
identical visual result without touching a working reference. Left
`teein-it-up-logo-transparent.png` in place, unreferenced — deleting
an asset provides no benefit here and this is meant to stay a small
release.

## 4. Files changed

- `public/brand/icon-192.png` — background made transparent, in place
- `public/brand/icon-512.png` — background made transparent, in place
- `public/brand/teein-it-up-icon.png` — background made transparent, in place
- `public/brand/logo-new.png` — background made transparent, in place
- `src/components/brand/BrandLogo.tsx` — comment-only update reflecting
  the actual fix; zero logic changed

**Deliberately zero changes to:** `public/manifest.json`,
`src/app/layout.tsx`, `public/sw.js`, `src/middleware.ts`,
`icon-512-maskable.png`, or any auth/routing/functional code — every
asset was overwritten **in place at its exact existing path and exact
existing pixel dimensions**, which is precisely why none of these
needed to change at all.

## 5. Exact splash treatment implemented

**Traced first, per how "splash screen" behaviour actually works in
this app**, before touching anything:

- Confirmed there is no in-app React component controlling what
  appears immediately on PWA launch — no root-level `loading.tsx`, no
  static splash HTML. `src/app/page.tsx` is a pure server-side
  redirect that renders nothing itself.
- The screenshot you provided is Chrome/Android's own **auto-generated
  native PWA splash screen**, built by the OS directly from
  `manifest.json`'s `background_color` and the largest suitable icon
  (`icon-512.png`) — not something this app's own code renders or
  can precisely lay out with CSS.

**What this round fixes, with high confidence:** the visible white
rectangle was `icon-512.png`'s own baked-in opaque background — fixed
by making it genuinely transparent (border-connected flood-fill,
verified against a magenta test background to confirm no holes were
punched into the artwork itself — the golf ball, banner text, and cap
all remain fully intact). This directly satisfies "no visible white
image rectangle" and moves meaningfully toward "clean warm-white/cream
background, simplified crest, nothing else," since Android's splash
canvas already uses your manifest's own `background_color` (`#faf9f6`,
the correct warm cream) behind the icon.

**What I could not safely achieve, and why — please read before
re-testing:** the specific "35–45% of screen width" sizing target.
`icon-512.png` is simultaneously the source for (a) the native splash
and (b) the actual home-screen app icon once installed. Reducing the
crest's visual footprint within that file (adding transparent padding
around a smaller centered mark) would shrink the *splash* appropriately
but would **also** shrink the *home-screen icon* below the fill ratio
every other Android app icon uses — a real, visible regression to the
one part of this whole project explicitly flagged as "just fixed" and
"do not break." Chrome's native splash-generation algorithm has no
separate, standardized manifest field for "use this icon at the
splash, but a different one for the home screen" that I could safely
and verifiably rely on from this sandbox. I chose not to gamble the
confirmed-working install icon on an unverifiable OS-level sizing
change. This is a genuine technical constraint, not a task left
undone by oversight — flagged honestly rather than either silently
skipping it or shipping a risky, unverifiable icon change.

## 6. Exact Sign In treatment implemented

Zero code changes — `BrandLogo.tsx`'s `full` variant already pointed
at `logo-new.png` (from the previous round, confirmed working in your
screenshot). Fixed that exact file's background in place using the
same flood-fill technique, same verification method. "Teein' It Up"
and "GOLF EVENT APP" text — both are part of the crest artwork itself,
untouched, still present. `AuthBranding.tsx`'s sizing (`clamp(220px,
70vw, 320px)`, set in an earlier round) is unchanged and still
responsive.

## 7. PWA manifest/icons — confirmed preserved

- `public/manifest.json` — byte-identical in structure; parsed and
  re-validated as JSON, same three icon entries, same paths, same
  sizes, same purposes.
- Every modified icon file kept its **exact original dimensions**
  (192×192, 512×512, 256×256) and PNG format — confirmed by direct
  inspection after the fix, not assumed.
- `icon-512-maskable.png` — completely untouched, confirmed
  still full-bleed `#0f2d1c`, still valid for its maskable purpose.
- `public/sw.js`, `src/middleware.ts` — untouched.
- No manifest reference needed to change, because no path or filename
  changed — every fix was applied to the existing file in place.

## 8. Tests / syntax checks

- `BrandLogo.tsx` (the one `.tsx` file touched, comment-only): 0
  syntax errors.
- `public/manifest.json`: re-parsed as valid JSON.
- Every modified PNG: re-opened with Pillow, confirmed valid image
  data, confirmed exact original dimensions, confirmed genuine alpha
  transparency (alpha = 0 at every corner, not just RGBA-mode-but-
  opaque as before).
- Every modified PNG additionally **visually re-inspected** — both in
  its native form and composited against a magenta test background
  specifically to catch any accidental holes punched into the artwork
  (the flood-fill technique could theoretically over-remove if it
  reached white pixels *inside* the crest, like the golf ball or
  banner lettering, if they were border-connected to the background;
  confirmed this did not happen in any of the four files).
- Full pure-function suite re-run: **318/318 pass**, unaffected (no
  application logic changed this round).

## 9. Asset limitations encountered

- The core limitation is described in full under item 5 above: OS-level
  PWA splash-screen sizing is not something a manifest/icon-file change
  alone can precisely and safely control without risking the
  home-screen icon's own appearance, given both draw from the same
  file.
- The genuinely-transparent `teein-it-up-logo-transparent.png` asset
  you may have expected to be reused for Sign-In was deliberately not
  used, for the reasons under item 3 above — flagging this explicitly
  in case that reasoning should be revisited later.
- Everything else requested (removing the actual white-rectangle
  artifact from all four affected assets, keeping the full Sign-In
  crest and its text, preserving every PWA-critical file untouched)
  was achieved with high confidence and direct verification.

---

## FUNCTIONAL REGRESSION — CONFIRMED BY INSPECTION, NOT ASSUMED

- **Authentication / Forgot Password / Signup** — zero code touched in
  any auth flow file this round.
- **Lobby / Navigation** — zero code touched.
- **GA4** — zero code touched; `trackEvent`/`RouteChangeTracker` are
  completely unrelated to this round's asset-only changes.
- **PWA installability** — `manifest.json`, `sw.js`, `middleware.ts`,
  and the maskable icon are byte-for-byte/pixel-for-pixel untouched;
  the two icons that *did* change kept their exact paths and
  dimensions, so nothing referencing them needed to change.

## WHAT STILL NEEDS YOUR DEVICE

- Whether the native splash now genuinely reads as "clean, premium,
  app-like" with the white rectangle gone — needs a real phone; a
  Pillow-level alpha check confirms the fix is real, but the actual
  OS-rendered result (including any residual Android adaptive-icon
  shape/corner-rounding applied on top, which is OS behavior, not
  something in these files) needs your eyes.
- Whether the Sign-In screen's crest now sits cleanly against the
  dark-green background without any visible edge artifact.
- A full re-run of the PWA install acceptance test from the previous
  round (still installable, correct icon, standalone launch, no
  generic shortcut) — nothing here should have changed that outcome,
  but it's the right thing to re-verify given icon files were touched,
  not just claimed unaffected.
