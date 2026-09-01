-- Ephemeral single-use pairing store for the PlanetScale OAuth login flow.
-- Supabase's Edge Runtime doesn't support Deno.openKv(), so this table
-- stands in for what would otherwise be a KV entry with a short TTL. Rows
-- are deleted the moment they're read (single-use) and opportunistically
-- swept of anything older than 10 minutes on every write/read.
--
-- RLS is enabled with no policies: only the service-role key (used by the
-- planetscale-oauth-callback and planetscale-oauth-refresh edge functions)
-- can touch this table — it never goes through PostgREST for anon/auth'd
-- clients, since it briefly holds real OAuth access/refresh tokens.
create table if not exists public.planetscale_oauth_sessions (
  session_id text primary key,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.planetscale_oauth_sessions enable row level security;
