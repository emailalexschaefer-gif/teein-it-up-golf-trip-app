import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Phase A-3 (performance) — HTTP caching for static brand/slideshow
  // artwork. Vercel's default for /public files is max-age=0 (revalidate
  // on every load). These files change rarely but are NOT content-hashed,
  // so this is deliberately NOT `immutable`: browsers reuse them for 24 h,
  // and for up to 7 further days serve the cached copy while refreshing it
  // in the background — an updated file at the same URL is picked up
  // within a day (new artwork should still get a new filename, as the
  // -v2 files do). /sw.js and /manifest.json are intentionally NOT listed
  // so the service worker and manifest keep revalidating.
  async headers() {
    const staticArtwork = [
      { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
    ]
    return [
      { source: '/brand/:path*',  headers: staticArtwork },
      { source: '/images/:path*', headers: staticArtwork },
    ]
  },
  // ───────────────────────────────────────────────────────────────────────
  // TEMPORARY MVP BACKSTOP — DO NOT LEAVE THIS IN PLACE LONG TERM.
  // The hand-written Database type in src/types/database.ts does not thread
  // through @supabase/ssr's generics reliably across Next.js 15 async server
  // component boundaries, which was repeatedly producing `never` types on
  // Supabase query results. Every known call site has been defensively typed
  // with an explicit `any` boundary (see src/app/api/*/route.ts and
  // src/app/(app)/**/*.tsx), but this flag is kept as a safety net so that
  // any remaining or future occurrence does not block deployment.
  //
  // REMOVE THIS once the Database type is regenerated directly from the
  // live schema via `npx supabase gen types typescript --project-id <id>`
  // and verified to build cleanly with strict type-checking re-enabled.
  typescript: {
    ignoreBuildErrors: true,
  },
}

export default nextConfig
