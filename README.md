# CoreConnect

Lead and waitlist manager for breeders and small businesses, sold through the
CoreStore AI storefront. Spec: *CoreConnect — Technical Requirements v1*.

Next.js (App Router) · Supabase (Postgres, Auth) · Drizzle · Tailwind · Vercel.

## Local development

Needs Node 22, pnpm 10 and Postgres 15+ on localhost (Docker is not required).

```sh
pnpm install
cp .env.example .env.local        # fill in Supabase values; DATABASE_URL can point at local Postgres
pnpm db:reset                     # rebuilds the local database (localhost only) from supabase/migrations
pnpm test                         # includes the cross-tenant RLS test
pnpm dev
pnpm jobs:dev                     # second terminal: runs the 1-minute scheduler tick
```

Without `RESEND_API_KEY` or Twilio keys, emails and texts are only logged to the
dev server console, so local work never messages anyone.

Tests rebuild their own database (`coreconnect_test`, override with
`TEST_DATABASE_URL`). `supabase/local/supabase-shim.sql` stands in for the
Supabase roles and `auth` schema so the migrations run on plain Postgres; it is
never applied to a real project.

## Database

`supabase/migrations/*.sql` is the source of truth. After changing it:

```sh
pnpm db:reset && pnpm db:pull     # regenerates lib/db/generated/schema.ts for typed queries
```

Rules every new tenant table must follow (the tests enforce the first three):

- RLS enabled, with a policy scoped by `workspace_id in (select app.my_workspace_ids())`.
- A `workspace_id` column.
- No privileges for `anon` (Supabase grants them by default, so revoke them).
- References to other tenant rows use a composite foreign key on `(workspace_id, id)`.

Server code reaches the database in two ways:

- `withUser(userId, tx => …)`, for anything done on behalf of a signed-in
  user. Runs as role `authenticated` with the user's claims, so RLS applies.
- `serviceDb()`, for webhooks, jobs and platform-admin pages only. It bypasses RLS.

## Background jobs

Outbound messages are queued in the `messages` table in the same transaction as
the event that caused them. `/api/jobs/tick` (every minute via Vercel Cron, see
`vercel.json`, or `pnpm jobs:dev` locally) runs due Nurture steps and delivers
queued messages with retries. Requests that queue a message also run a tick
right after responding, so auto-replies go out in seconds.

## Connecting Supabase and Vercel

1. Create a Supabase project (Postgres 15 or 17).
2. Install the Supabase CLI, then run `supabase init` (it keeps the existing
   migrations), `supabase link --project-ref <ref>` and `supabase db push`.
3. In Supabase Auth settings:
   - Turn off public sign-ups. Owners and staff are invited.
   - Under **Redirect URLs**, add `http://localhost:3000/**`, your production
     domain and `https://*-<your-team>.vercel.app/**` for preview deploys.
4. Make yourself platform admin. Sign in once, then run this in the SQL editor:
   `update public.users set is_platform_admin = true where email = 'you@example.com';`
5. Import the GitHub repo in Vercel and set the variables from `.env.example`
   for Production and Preview. `DATABASE_URL` must be the transaction-mode
   pooler URL (port 6543).

Create workspaces at `/admin/workspaces`. Creating one invites the owner by email.
