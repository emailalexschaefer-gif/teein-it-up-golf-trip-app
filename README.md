# Teein' It Up — MVP

> Run Your Golf Trip Like A Pro.

## Getting Started

### 1. Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Vercel](https://vercel.com) account (for deployment)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in your values from the Supabase dashboard (Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run database migrations

In your Supabase project, open the SQL editor and run each migration in order:

```
supabase/migrations/001_profiles.sql
supabase/migrations/002_trips.sql
supabase/migrations/003_trip_info.sql
supabase/migrations/004_scoring.sql
supabase/migrations/005_side_comps.sql
supabase/migrations/006_photos_memory_leaderboard.sql
```

Or with the Supabase CLI:

```bash
supabase db push
```

### 5. Configure Supabase Auth

In your Supabase dashboard:

1. **Authentication → Settings → Email**
   - Enable "Enable Email Signup"
   - Enable "Enable Magic Links / OTP"

2. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000` (dev) or your production URL
   - Redirect URLs: add `http://localhost:3000/api/auth/callback`

### 6. Create Supabase Storage buckets

In Supabase dashboard → Storage, create two buckets:

| Bucket | Public | Purpose |
|--------|--------|---------|
| `trip-assets` | ✓ Yes | Logos, cover images |
| `trip-photos` | ✓ Yes | Player photos, Memory Pack outputs |

### 7. Generate TypeScript types (after migrations)

```bash
npm run db:generate-types
```

This replaces the hand-authored `src/types/database.ts` with auto-generated types from your schema.

### 8. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment (Vercel)

1. Push to GitHub
2. Import project in Vercel
3. Set environment variables in Vercel dashboard (Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` → your production domain
4. Deploy

---

## Project Structure

```
src/
├── app/
│   ├── (auth)/          # Login, join trip — unauthenticated
│   ├── (app)/           # Protected — requires auth
│   │   ├── dashboard/   # My Trips (product home)
│   │   └── trips/       # Trip detail and sub-pages
│   └── api/             # Server-side API routes
├── components/
│   ├── ui/              # Primitive components
│   ├── trips/           # Trip cards, list, empty states
│   ├── scoring/         # Scorecard entry (Sprint 4)
│   └── layout/          # Nav, providers, sync
├── lib/
│   ├── supabase/        # Browser + server clients
│   ├── db/              # Dexie offline queue + sync worker
│   ├── scoring/         # Stableford engine
│   └── queries/         # React Query hooks
├── store/               # Zustand stores
│   ├── tripStore.ts     # Active trip context
│   └── syncStore.ts     # Offline queue status
└── types/               # TypeScript types
    ├── database.ts      # DB schema types (auto-generated)
    └── app.ts           # App-level types
```

---

## Architecture Notes

- **Backend is always source of truth.** Dexie (IndexedDB) is a sync queue only.
- **Score writes go through `/api/scores`**, not directly to Supabase client. Server validates before writing.
- **RLS is enabled on every table.** Never disabled.
- **Leaderboard is a PostgreSQL view.** Consistent across all clients.
- **Roles are trip-scoped.** A user can be organiser on one trip and player on another.
- **Stableford points are computed by a DB trigger** on `score_entries` INSERT/UPDATE.

---

## Sprint Status

| Sprint | Status | Description |
|--------|--------|-------------|
| Sprint 1 | ✅ Complete | Foundation — auth, schema, offline queue, My Trips shell |
| Sprint 2 | 🔲 Next | Trip creation, member invitation, info hub |
| Sprint 3 | 🔲 | Scoring UI, round setup, live scorecard entry |
| Sprint 4 | 🔲 | Live leaderboard, Realtime, side comps |
| Sprint 5 | 🔲 | Results, Memory Pack generation |
| Sprint 6 | 🔲 | Polish, mobile UX, beta testing |
