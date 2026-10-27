Dev-only Chromium harness used for the 27 Oct presentation polish checks (not part of the app or the test suite).
entry.tsx renders the REAL EventHighlightsPlayer with fixture slides; run.cjs drives Playwright at 1366x768, 1920x1080 and 844x390
and checks every text element stays inside the 16:9 stage, plus music OFF by default / manual toggle. Bundle with esbuild
(alias '@' -> src, 'next/link' -> link.tsx, define process.env.NEXT_PUBLIC_PRESENTATION_APPLAUSE=undefined). Paths inside run.cjs
point at the original scratch folder; adjust before reuse.
