# Supabase → Neon backend migration

Source: Supabase project `yjdsrmnpbhgfqrubvicz`
Target: Neon project **RexaDB Backend** (`shy-mouse-25854751`), branch `main`
(`br-nameless-dust-b4dr6oh3`), database `neondb`, region `aws-us-east-2`, PG 18.

## What moved

| Supabase | Neon |
|---|---|
| GoTrue Auth (`supabase.auth.*`) | Neon Managed Better Auth (Data API). **All** sign-in/session call sites (`auth-page`, `onboarding-flow`, `nav-user`, `connections-*`, `use-auth-state`) go through `getBackendAuth()` so the session lives on the same client as the data calls |
| `public.profiles, user_settings_sync, community_themes, subscription_plans, user_subscriptions, cloud_connections` | Same tables, recreated by `neon/migrations/20261014_backend_schema.sql` |
| RPCs `save_user_settings_sync, publish_community_theme, increment_theme_downloads, log_app_error, save/delete_cloud_connection` (+ new `app_errors` table) | Same signatures, re-created in the migration SQL. `save_user_settings_sync` guards staleness atomically in `ON CONFLICT ... WHERE` (no lost-update race); `publish_community_theme` fills `author_name` from `profiles` |
| Edge Functions `entitlement, subscribe, planetscale-oauth-callback, planetscale-oauth-refresh` | Same slugs under the Neon base URL (`getEdgeFunctionUrl()` / `invokeBackendFunction()`), to be deployed as Neon Functions |
| `auth.sessions` trigger `enforce_session_limit_webhook` | Not ported — no `auth` schema on Neon. Enforce session limits in app middleware instead |

## How to use

```bash
# New backend (Neon Data API + Managed Better Auth)
NEXT_PUBLIC_NEON_URL=https://<neon-host>/neondb bun run dev

# Old backend (Supabase, fallback while cutting over)
NEXT_PUBLIC_SUPABASE_URL=https://yjdsrmnpbhgfqrubvicz.supabase.co \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... bun run dev
```

`lib/supabase/backend-client.ts` picks Neon when `NEXT_PUBLIC_NEON_URL` is set,
otherwise Supabase. No other code changes needed at call sites.

## Data migration (owner run, one time)

Requires the Supabase DB password (Dashboard → Project Settings → Database)
and the Neon connection string (Console → Connect). Use **unpooled**
connections for `pg_dump`, `--no-owner --no-acl` on restore (Supabase
ownership/ACLs are tied to its auth system and must be dropped; RLS is
re-applied by the migration SQL):

```bash
pg_dump -Fc -v \
  -d "postgresql://postgres:<supabase-db-password>@db.yjdsrmnpbhgfqrubvicz.supabase.co:5432/postgres" \
  --schema=public -f supabase_dump.bak

pg_restore -d "<neon-connection-string>" -v --no-owner --no-acl supabase_dump.bak
```

Then re-run `neon/migrations/20261014_backend_schema.sql` to ensure
functions/policies exist, and verify row counts per table.

For near-zero downtime instead, use logical replication:
https://neon.com/docs/guides/logical-replication-supabase-to-neon

## Auth caveat

Password-based `auth.users` **cannot** transfer (Supabase vs Better Auth use
incompatible password hashes). Plan: users sign up again on Neon or sign in
via OAuth. Do not attempt to copy `auth.*` schemas.

## Post-migration checklist

- [ ] Enable Data API + Managed Better Auth on the Neon branch
- [ ] Deploy `entitlement` + planetscale OAuth functions as Neon Functions
- [ ] Set `NEXT_PUBLIC_NEON_URL` in all environments (`.env`, nix, CI, Tauri)
- [ ] Smoke test: sign-up, sign-in, session persist, settings sync, themes,
      entitlement refresh, error logging
- [ ] Remove Supabase env + `@supabase/supabase-js` once cut over
