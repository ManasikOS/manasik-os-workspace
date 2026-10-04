# Royal Al-Fathima Travels — CRM

Operations platform for a Hajj & Umrah travel agency: leads, departure
groups, pilgrims, documents, visa, finance and reporting in one workspace.
Built on Next.js (App Router) with Supabase for auth, database and storage.

## Stack

- **Next.js 16** (App Router, Server Components, Server Actions)
- **Supabase** — Postgres with Row Level Security, Auth, Storage
- **Anthropic API** — the AI Document Agent (`lib/data/documents-ai.ts`)
- **Tailwind CSS v4**, shadcn-derived UI components

## Production DB

supabase link --project-ref bidmihfsljrurlnraqmf
supabase migration list --linked
supabase db push --dry-run

## Staging DB

supabase link --project-ref klognjpwmqwlgeibvanf
supabase migration list --linked
supabase db push --dry-run

supabase link --project-ref bidmihfsljrurlnraqmf # asks for the production DB password
supabase db push --dry-run # shows what WOULD run. Read it.
supabase db push # applies it. Answer Y.
supabase migration list --linked # all rows should now match
supabase link --project-ref klognjpwmqwlgeibvanf # IMPORTANT: point back at staging

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values — see that
   file for what each one gates. At minimum you need
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to
   run at all; `SUPABASE_SECRET_KEY` and `OPENROUTER_API_KEY` unlock team
   administration and the AI Document Agent respectively.

3. Apply the database schema. The full schema — tables, RLS policies, views,
   storage buckets — lives in `supabase/migrations/`, in order:

   ```bash
   npx supabase db push
   ```

   (or run each file in `supabase/migrations/` against your Postgres
   instance in filename order, if you're not using the Supabase CLI).

4. Run the dev server:

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) — it redirects to
   `/dashboard`, which requires a signed-in session (`/login`).

## Access model

Every module gates access through a per-role capability matrix in
`lib/access/*-access.ts`, resolved server-side from `staff_profiles.role`
(`getCurrentStaffRole()` in `lib/data/departure-groups.ts`). The same role
set is enforced again in the database via Row Level Security
(`supabase/migrations/20260822090000_rls_hardening.sql`) — the application
layer decides what's _rendered_, RLS decides what's ever _fetchable_, so
neither is the sole line of defence.

The first user created via `20260820090000_team_access.sql`'s backfill (or
any account with no matching `staff_role` in `raw_user_meta_data`) is
provisioned as `ADMIN`.

## Scripts

```bash
npm run dev         # start the dev server
npm run build        # production build
npm run start          # run the production build
npm run lint             # eslint (0 errors; warnings not yet enforced — see docs/architecture/production-readiness-plan.md)
npm run typecheck          # tsc --noEmit
```

## Further reading

Full documentation index: [`docs/README.md`](docs/README.md).

- `docs/modules/*-implementation-plan.md` — the design spec each module was
  built against.
- `docs/architecture/production-readiness-plan.md` — the outstanding work
  between here and a production deploy.
- `docs/standards/feature-development-workflow.md` — the process to follow
  when building any new feature.
- `AGENTS.md` — the rules an AI agent (or a human) follows when working in
  this repo.
