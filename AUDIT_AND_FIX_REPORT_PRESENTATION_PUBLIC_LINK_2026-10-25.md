# Event Presentation sharing asks for sign-in — audit and fix (2026-10-25)

Not deployed. No migration applied. Built on the My Golf tree; separate from Package 3.

## Audit
- A public presentation route already exists (Release 3S): `/s/{token}`, with media at `/api/s/{token}/m/{momentId}`. Both are in the middleware allowlist (`isPublicRoute`), authorise only by an unguessable 43-char token, read only the consent-filtered public deck, and require `status='active'` and `public_enabled=true`. Revocation (Unpublish) makes the page and media return "no longer available"/404. The public viewer makes no authenticated calls. So this is **not** a middleware/routing defect (D) and public-sharing functionality is **not missing** (C).
- Public sharing is **off by default** (a checkbox, "Also allow a shareable link for people outside the event"). With it off, the publish panel's only link, shown and copyable via "Copy Link", was the members-only page `/trips/{tripId}/presentation`. Middleware sends signed-out visitors for that URL to `/login?redirectTo=…`, which matches Marty's screen. The chat post's "Watch Presentation" button also points at the members-only page (Copy Link there appears only when public is on).
- **Most likely cause: A/B** — the link Darren sent was the members-only link because public sharing was never switched on, and the panel did not make that clear enough. **Not confirmed**: I have not seen the exact link Darren sent. If the URL he sent contains `/trips/…/presentation` it is this; if it contains `/s/…` and still asks for sign-in, that points to something else and I need the URL.
- Not verifiable here: real middleware run (`next` is not installed in the sandbox), live Supabase data, signed media URLs in production, WhatsApp, Samsung/iPhone devices.

## Smallest safe correction (UI only; no migration, no route/middleware/security change)
- `lib/sharing/linkChoice.ts` decides the link shown. Public on → "Public viewing link — opens without signing in" / "Copy public link". Public off → "Members-only link (public sharing is off)" / "Copy members-only link" plus an amber warning that outsiders will be asked to sign in and how to get a public link.
- Toggle relabelled "Share with anyone who has the link (no sign-in needed)" with plain On/Off explanation.
- Unchanged: public sharing stays off by default, still requires the organiser's explicit tick plus the clearance acknowledgement, name-privacy rules, per-photo exclusion, revocation, and token security.
- How Darren fixes the Lappen link: open Share Event Presentation, tick the public option, confirm, Update; the panel then shows the `/s/` link. (Not done for him; production untouched.)

## Tests
- Full suite 1368 pass / 0 fail / 0 skipped (1362 before + 6 new). Lint-style, hook and type checks on changed files clean.
- New tests: public link is `/s/` and public; members link is flagged and needs sign-in; members link never labelled shareable/public; panel keeps default-off and acknowledgement; `/s/` and `/api/s/` public while members routes stay protected; public viewer has no authenticated calls and reads only the public deck/approved moments of an active, public-enabled publication. Existing tests still cover revocation and private-Moment exclusion.
- Phone-width preview of the panel (public off) checked.

## Your requested scenarios
Covered by code/tests: public link outside login, revoked link stops, restricted Moments excluded, no redirect to login on `/s/`. **Not verified (need a real device/environment):** non-member in incognito, WhatsApp open, watching the full deck with photos/videos, signed URL lifetime (photo 10 min, video 30 min per existing config; the viewer redirects to a fresh signed URL on each media request), Samsung Chrome/iPhone Safari.
