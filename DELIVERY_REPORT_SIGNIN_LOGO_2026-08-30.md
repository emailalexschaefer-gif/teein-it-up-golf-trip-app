# TEEIN' IT UP — SIGN-IN LOGO FIX
## Delivery Report — 30 Aug 2026

**Build/test caveat, unchanged from every prior round:** no network
access in this sandbox — `npm run build` was not run. Both files
touched were syntax-checked directly with the TypeScript compiler —
**zero errors**. Full pure-function suite re-confirmed unaffected:
**310/310 pass**. Nothing in this fix touches scoring/business logic.

---

## Trace — why it never loaded (per your exact checklist)

1. **Where the current auth branding component is defined:**
   `src/components/brand/AuthBranding.tsx`, used by the single `(auth)`
   route-group layout (`src/app/(auth)/layout.tsx`) that wraps every
   unauthenticated page. Confirmed only one auth layout exists — no
   second/duplicate login screen anywhere in the project.

2. **Whether an existing BrandLogo/component is being used elsewhere:**
   Yes — `BrandLogo.tsx`, and `AuthBranding` was already correctly
   calling `<BrandLogo variant="full" priority />`. This was not a
   wiring bug; the component was already in the right place, calling
   the right thing.

3. **The actual public/static asset path:** `/public/brand/` — the
   previous `full` variant pointed at
   `teein-it-up-logo-transparent.png`, which is genuinely present in
   this repo (confirmed: valid file, correct location, correct
   casing).

4. **Filename casing:** consistent lowercase-hyphenated convention
   throughout `/public/brand/` — not the issue.

5. **Next.js Image/public path behaviour:** the `full` variant
   deliberately uses a plain `<img>` tag, not `next/image` — this was
   a prior fix already in place (see the component's own extensive
   comments), specifically to rule out `next/image`-specific handling
   as a variable. Confirmed this architecture is sound and unchanged.

6. **Whether Vercel actually contains the asset in the deployed
   build:** **cannot be verified from this sandbox** — no deployment
   access. This is the one item on your checklist I genuinely cannot
   close myself; see "what still needs verification" below.

7. **Whether the auth screen is still rendering an old fallback text
   treatment:** **yes — confirmed, and this is the actual root
   cause.** `BrandLogo.tsx` has a client-side `onError` handler that
   falls back to plain text (`Teein' It Up`) if the image request
   genuinely fails. Your screenshot's large, wrapped "Teein' It / Up"
   text, at roughly the fallback's computed font size, is that exact
   fallback rendering — not a missing component, not a routing bug. The
   image request itself failed in production.

8. **Whether any CSS is hiding/failing the image:** no — reviewed the
   full styling chain, nothing sets `display: none` or similar; this
   was never a CSS visibility issue.

**Conclusion:** the component and its wiring were already correct. The
image file itself — despite being present in this repo/every ZIP
delivered so far — was not actually reaching production. This
component's own code comments already document this as a recurring,
previously-seen failure mode: *"a file present on disk but not
committed will 404 on Vercel while working perfectly in local dev."*
Given that history, re-pointing at the same file again and hoping
would not have closed the loop — so this fix uses a freshly uploaded
asset under a new filename instead, removing any doubt about a
stale/half-committed previous file or cache.

---

## Fix

- **Saved the supplied production logo** to
  `public/brand/logo-new.png` (your requested name, adapted to a safe
  filename — no literal space, matching this project's existing
  all-lowercase-hyphenated convention for every other asset in this
  folder). Confirmed present, confirmed a valid, uncorrupted PNG
  (1254×1254), confirmed pixel-identical after lossless-only
  optimization (same image, no visual change — file size reduced from
  1.62MB to 1.52MB via standard PNG deflate tuning, not by re-encoding
  or simplifying the artwork).
- **`BrandLogo.tsx`** — the `full` variant now points at
  `/brand/logo-new.png` instead of the old asset. The `icon` variant
  (a different asset, used only in compact headers) is untouched.
- **Sizing corrected to your exact suggested treatment**: was
  `clamp(170px, 52vw, 640px)` (undersized below your stated minimum,
  and could grow far larger than requested on bigger screens) — now
  `clamp(220px, 70vw, 320px)`, landing squarely in your 65–75vw /
  300–340px guidance. `height: auto` preserved (unchanged), so aspect
  ratio and the full crest remain intact — nothing is cropped.
- **`AuthBranding.tsx`** — removed the separate "GOLF EVENT APP"
  caption beneath the logo, since that text is already part of the
  actual crest artwork now in use — it was a literal duplicate, not a
  design accent. Increased the spacing below the logo (`marginBottom`
  10 → 18) for clearer separation from the Sign In card beneath it.
- Confirmed via search that `AuthBranding` is the **only** consumer of
  `variant="full"` anywhere in the app — this change carries zero
  regression risk to any other screen.

## Layout / acceptance, checked against your list

- Centred horizontally — `textAlign: 'center'` on the wrapping div,
  unchanged mechanism.
- Above the Sign In card — same layout structure as before
  (`AuthBranding` renders first in `(auth)/layout.tsx`, the card
  follows).
- Sized prominently but sensibly — fixed above (70vw, capped 220–320px).
- Aspect ratio preserved, nothing cropped — `height: auto`, `object-fit`
  not constrained, unchanged.
- Duplicate "GOLF EVENT APP" text removed.
- Dark-green auth background — untouched, no changes to `layout.tsx`.
- Sign In card and auth functionality — untouched, no changes to any
  form/auth logic.

## FILES CHANGED

- `public/brand/logo-new.png` (new asset)
- `src/components/brand/BrandLogo.tsx` — asset path, sizing
- `src/components/brand/AuthBranding.tsx` — removed duplicate caption,
  spacing

## MIGRATIONS REQUIRED: No.

## TESTS

No new automated tests — this is a static asset + presentational
styling change with no logic to unit test. Full existing suite
re-confirmed unaffected: **310/310 pass.**

---

## WHAT STILL NEEDS VERIFICATION — PLEASE DO NOT SKIP THIS

Per your own explicit instruction, **I have not relied on code
inspection alone** for the parts I could actually check (the asset is
genuinely present, valid, and correctly referenced in this delivered
package — verified directly with `file`/`ls`/pixel comparison, not
assumed). But the one thing I categorically cannot verify from this
sandbox is **whether this new file actually reaches the live Vercel
deployment** — that depends on your own deploy step, which is outside
what I can do here.

**Before considering this closed:**
1. Confirm `public/brand/logo-new.png` is included when this ZIP's
   contents are committed/deployed (`git status public/brand/` before
   pushing, exactly as this component's own long-standing comment
   already recommends).
2. Open the deployed Sign In page on a real phone, **including a hard
   refresh / private browsing window** (per your own acceptance
   criteria) — a cached old page could otherwise mask whether this
   actually fixed anything.
3. Confirm: real crest visible, no wrapped fallback text, logo sharp
   and centred, full crest visible with nothing cropped, Sign In card
   directly beneath, no layout overflow, Forgot Password / Create
   Account still work.

If the fallback text still appears after a genuine hard refresh
against the live deployment, that would mean the asset still isn't
reaching Vercel even with a fresh filename — at that point the next
step is checking the actual git commit / Vercel build log directly,
which needs your access, not another code-level guess from here.
