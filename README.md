# Teein' It Up — MVP

> Run Your Golf Trip Like A Pro.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variables

```bash
cp .env.example .env.local
```

Fill in the three values from your Supabase dashboard (Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

That is all that is required — no other environment variables.

### 3. Run database migrations

Open your Supabase project → SQL Editor and run each file in order:

```
supabase/migrations/001_profiles.sql
supabase/migrations/002_trips.sql
supabase/migrations/003_trip_info.sql
supabase/migrations/004_scoring.sql
supabase/migrations/005_side_comps.sql
supabase/migrations/006_photos_memory_leaderboard.sql
```

### 4. Configure Supabase Auth

In your Supabase dashboard → Authentication → Settings:
- Enable **Email** provider
- Enable **Magic Links / OTP**

In Authentication → URL Configuration:
- Site URL: `http://localhost:3000` (dev) or your production domain
- Redirect URLs: add `https://your-domain.com/api/auth/callback`

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

1. Push this repository to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repository
3. Vercel will detect Next.js automatically — no build configuration needed
4. Add **exactly these three environment variables** under Settings → Environment Variables:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → service_role key |

5. Click **Deploy**

No other configuration is required. No Vercel secrets. No additional env vars.

After deploying, update Supabase Auth → URL Configuration with your production domain.

---

## Project structure

```
src/
├── app/
│   ├── (auth)/          # Login, join trip pages
│   ├── (app)/           # Protected pages (requires auth)
│   │   ├── dashboard/   # My Trips — product home
│   │   └── trips/       # Trip creation, detail
│   └── api/             # Server-side API routes
├── components/
│   ├── ui/              # Button, FormFields, Toast, Layout
│   ├── trips/           # Trip cards, list, wizard steps
│   └── layout/          # Nav, providers, sync initializer
├── lib/
│   ├── supabase/        # Browser + server clients
│   ├── db/              # Dexie offline queue + sync worker
│   ├── scoring/         # Stableford engine
│   ├── queries/         # React Query hooks
│   └── utils.ts         # Helpers including getAppUrl()
├── store/               # Zustand (trip context, sync status)
└── types/               # TypeScript types (database + app)
supabase/migrations/     # SQL — run in order 001–006
```

## Architecture notes

- **Three env vars only.** `NEXT_PUBLIC_APP_URL` is not needed — the app URL is derived automatically from `window.location.origin` (client) or `VERCEL_URL` (server).
- **Backend is always source of truth.** Dexie (IndexedDB) is a sync queue only — scores are saved locally immediately, then synced when online.
- **Score writes go through `/api/scores`** for server-side validation before writing to Supabase.
- **RLS enabled on every table.** Never disabled.
- **Roles are trip-scoped.** A user can be organiser on one trip and player on another.
- **Next.js 15** — all server components use `await createClient()` and `await params`.
