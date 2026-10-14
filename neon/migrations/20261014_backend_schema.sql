-- Neon backend schema ported from Supabase (public schema only).
--
-- Source: Supabase project yjdsrmnpbhgfqrubvicz (public tables + RPCs inferred
-- from app usage in lib/supabase/*, lib/auth/*, lib/billing/*, lib/error-logger.ts).
-- Target: Neon project "RexaDB Backend" (shy-mouse-25854751), branch main
-- (br-nameless-dust-b4dr6oh3), database neondb.
--
-- Migration procedure (run with owner creds, see docs/neon-migration.md):
--   pg_dump -Fc -v -d "postgresql://..." --schema=public -f supabase_dump.bak
--   pg_restore -d "<neon-connection-string>" -v --no-owner --no-acl supabase_dump.bak
--
-- This file is the checked-in, reviewable equivalent: it creates the tables,
-- indexes, RLS policies, and RPCs the app needs so a fresh Neon branch works
-- without a dump. It is idempotent (IF NOT EXISTS / OR REPLACE) and safe to
-- re-run. Supabase-managed schemas (auth, storage, supabase_functions) are
-- intentionally NOT ported — Neon Auth (Managed Better Auth) replaces GoTrue.
--
-- Password-based auth.users CANNOT be migrated (incompatible hashing between
-- Supabase Auth and Neon Managed Better Auth). Users sign up again or use
-- OAuth. See docs/neon-migration.md.

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles (lib/auth/user-profile.ts selects full_name by id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- user_settings_sync (lib/supabase/settings-sync.ts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings_sync (
  user_id uuid PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Helper resolving the caller across Supabase (auth.uid()) and Neon Data API
-- (session JWT claim). Supabase path wins when present. Must be created before
-- the RPCs below (runtime dependency).
CREATE OR REPLACE FUNCTION public.auth_uid()
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  BEGIN
    RETURN auth.uid();
  EXCEPTION WHEN undefined_function OR undefined_table OR invalid_schema_name THEN
    -- Not on Supabase: fall back to the Data API JWT claim.
    BEGIN
      RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RETURN NULL;
    END;
  END;
END;
$$;

-- Last-write-wins on client_updated_at so offline devices don't clobber newer
-- settings. Returns the winning row with an `applied` flag.
CREATE OR REPLACE FUNCTION public.save_user_settings_sync(
  p_payload jsonb,
  p_client_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth_uid();
  v_row public.user_settings_sync%ROWTYPE;
  v_applied boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM public.user_settings_sync WHERE user_id = v_uid;

  IF v_row.user_id IS NULL OR p_client_updated_at >= v_row.client_updated_at THEN
    INSERT INTO public.user_settings_sync (user_id, payload, client_updated_at, updated_at)
    VALUES (v_uid, COALESCE(p_payload, '{}'::jsonb), p_client_updated_at, now())
    ON CONFLICT (user_id) DO UPDATE SET
      payload = EXCLUDED.payload,
      client_updated_at = EXCLUDED.client_updated_at,
      updated_at = now()
    RETURNING * INTO v_row;
    v_applied := true;
  END IF;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'user_id', v_row.user_id,
    'payload', v_row.payload,
    'client_updated_at', v_row.client_updated_at,
    'updated_at', v_row.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- community_themes (lib/supabase/theme-marketplace.ts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  theme_type text NOT NULL CHECK (theme_type IN ('app', 'editor')),
  theme_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_id uuid,
  author_name text NOT NULL DEFAULT '',
  downloads integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_themes_type_downloads_idx
  ON public.community_themes (theme_type, downloads DESC);
CREATE INDEX IF NOT EXISTS community_themes_author_idx
  ON public.community_themes (author_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.publish_community_theme(
  p_name text,
  p_description text,
  p_theme_type text,
  p_theme_json jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth_uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '28000';
  END IF;
  IF p_theme_type NOT IN ('app', 'editor') THEN
    RAISE EXCEPTION 'Invalid theme type.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.community_themes (name, description, theme_type, theme_json, author_id)
  VALUES (p_name, COALESCE(p_description, ''), p_theme_type, COALESCE(p_theme_json, '{}'::jsonb), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_theme_downloads(theme_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.community_themes
  SET downloads = downloads + 1, updated_at = now()
  WHERE id = theme_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Billing: subscription_plans + user_subscriptions
-- (lib/billing/entitlement-shared.ts, entitlement-server.ts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  code text PRIMARY KEY,
  cloud_enabled boolean NOT NULL DEFAULT true,
  max_connections integer,
  max_workspaces integer
);

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan text NOT NULL DEFAULT 'free',
  status text NOT NULL DEFAULT 'active',
  ends_at timestamptz,
  updates_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_subscriptions_user_created_idx
  ON public.user_subscriptions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_subscriptions_user_status_idx
  ON public.user_subscriptions (user_id, status);

-- Seed the free plan so entitlement resolution never returns null.
INSERT INTO public.subscription_plans (code, cloud_enabled, max_connections, max_workspaces)
VALUES ('free', true, NULL, NULL)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- app_errors (lib/error-logger.ts rpc log_app_error)
-- Anonymous inserts allowed (rate-limited app-side to 50KB); reads restricted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  error_type text NOT NULL DEFAULT 'unknown',
  message text NOT NULL DEFAULT '',
  stack text,
  url text,
  component_stack text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  app_version text,
  os text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_errors_created_idx
  ON public.app_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS app_errors_type_created_idx
  ON public.app_errors (error_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_app_error(
  p_error_type text,
  p_message text,
  p_stack text,
  p_url text,
  p_component_stack text,
  p_metadata jsonb,
  p_app_version text,
  p_os text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.app_errors (
    user_id, error_type, message, stack, url, component_stack, metadata, app_version, os
  )
  VALUES (
    auth_uid(),
    COALESCE(p_error_type, 'unknown'),
    COALESCE(p_message, ''),
    p_stack, p_url, p_component_stack,
    COALESCE(p_metadata, '{}'::jsonb),
    p_app_version, p_os
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security (Neon Data API enforces these; review after pg_restore
-- with --no-acl since Supabase grants are intentionally dropped)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_owner_read" ON public.profiles;
CREATE POLICY "profiles_owner_read" ON public.profiles
  FOR SELECT USING (id = auth_uid());

DROP POLICY IF EXISTS "profiles_owner_write" ON public.profiles;
CREATE POLICY "profiles_owner_write" ON public.profiles
  FOR ALL USING (id = auth_uid()) WITH CHECK (id = auth_uid());

DROP POLICY IF EXISTS "settings_sync_owner" ON public.user_settings_sync;
CREATE POLICY "settings_sync_owner" ON public.user_settings_sync
  FOR ALL USING (user_id = auth_uid()) WITH CHECK (user_id = auth_uid());

DROP POLICY IF EXISTS "themes_public_read" ON public.community_themes;
CREATE POLICY "themes_public_read" ON public.community_themes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "themes_author_write" ON public.community_themes;
CREATE POLICY "themes_author_write" ON public.community_themes
  FOR ALL USING (author_id = auth_uid()) WITH CHECK (author_id = auth_uid());

DROP POLICY IF EXISTS "plans_public_read" ON public.subscription_plans;
CREATE POLICY "plans_public_read" ON public.subscription_plans
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "subscriptions_owner_read" ON public.user_subscriptions;
CREATE POLICY "subscriptions_owner_read" ON public.user_subscriptions
  FOR SELECT USING (user_id = auth_uid());

DROP POLICY IF EXISTS "app_errors_anon_insert" ON public.app_errors;
CREATE POLICY "app_errors_anon_insert" ON public.app_errors
  FOR INSERT WITH CHECK (true);
