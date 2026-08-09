-- OTL (One-Time License): perpetual license with 12-month update window

-- 1. Add 'otl' plan code to the subscription_plan enum
ALTER TYPE public.subscription_plan ADD VALUE IF NOT EXISTS 'otl';

-- 2. Add updates_until column to user_subscriptions
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS updates_until timestamptz;

-- 3. Add Polar one-time product ID column to subscription_plans
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS stripe_otl_price_id text;

-- 4. Add is_otl flag to distinguish OTL plans from recurring plans
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_otl boolean NOT NULL DEFAULT false;

-- Ensure columns used in the seed row exist (may be missing if 20260310_subscription_v1.sql wasn't applied)
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS monthly_storage_mb bigint,
  ADD COLUMN IF NOT EXISTS max_team_members integer,
  ADD COLUMN IF NOT EXISTS max_workspaces integer;

-- Seed OTL plan row
INSERT INTO public.subscription_plans
  (code, name, description, monthly_price_cents, currency,
   cloud_enabled, max_connections,
   monthly_storage_mb, max_team_members, max_workspaces,
   is_otl, is_active)
VALUES
  ('otl', 'One-Time License',
   'Perpetual license with 12 months of updates',
   49900, 'usd', true, 25, 10240, 1, 3,
   true, true)
ON CONFLICT (code) DO UPDATE
  SET name = excluded.name,
      description = excluded.description,
      monthly_price_cents = excluded.monthly_price_cents,
      is_otl = excluded.is_otl;

-- New RPC: extend_otl_updates
CREATE OR REPLACE FUNCTION public.extend_otl_updates(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing timestamptz;
BEGIN
  SELECT updates_until INTO v_existing
  FROM public.user_subscriptions
  WHERE user_id = p_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO public.user_subscriptions
    (user_id, plan, status, updates_until)
  VALUES (
    p_user_id,
    'otl'::public.subscription_plan,
    'active'::public.subscription_status,
    GREATEST(COALESCE(v_existing, now()), now()) + interval '12 months'
  )
  ON CONFLICT (user_id) DO UPDATE
  SET plan = 'otl'::public.subscription_plan,
      status = 'active'::public.subscription_status,
      updates_until = GREATEST(
        COALESCE(user_subscriptions.updates_until, now()),
        now()
      ) + interval '12 months',
      ends_at = NULL,
      updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_otl_updates(uuid) TO service_role;

-- Update subscribe_to_plan RPC to support updates_until
CREATE OR REPLACE FUNCTION public.subscribe_to_plan(
  p_plan_code public.subscription_plan,
  p_interval text DEFAULT 'month',
  p_provider_subscription_id text DEFAULT NULL,
  p_provider_customer_id text DEFAULT NULL,
  p_cancel_at_period_end boolean DEFAULT false,
  p_status public.subscription_status DEFAULT 'active',
  p_user_id uuid DEFAULT auth.uid(),
  p_updates_until timestamptz DEFAULT NULL
)
RETURNS public.user_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_plan public.subscription_plans%rowtype;
  v_ends_at timestamptz;
  v_row public.user_subscriptions%rowtype;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing user id';
  END IF;

  IF p_interval NOT IN ('month', 'year') THEN
    RAISE EXCEPTION 'Invalid interval: %', p_interval;
  END IF;

  SELECT *
  INTO v_plan
  FROM public.subscription_plans
  WHERE code = p_plan_code
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan not found or inactive: %', p_plan_code;
  END IF;

  v_ends_at := CASE
    WHEN p_status = 'canceled' THEN now()
    WHEN p_interval = 'year' THEN now() + interval '1 year'
    ELSE now() + interval '1 month'
  END;

  INSERT INTO public.user_subscriptions (
    user_id,
    plan,
    status,
    started_at,
    ends_at,
    stripe_subscription_id,
    updates_until
  )
  VALUES (
    v_user_id,
    p_plan_code,
    p_status,
    now(),
    v_ends_at,
    p_provider_subscription_id,
    p_updates_until
  )
  ON CONFLICT (user_id)
  DO UPDATE
    SET plan = excluded.plan,
        status = excluded.status,
        started_at = excluded.started_at,
        ends_at = excluded.ends_at,
        stripe_subscription_id = excluded.stripe_subscription_id,
        updates_until = COALESCE(excluded.updates_until, user_subscriptions.updates_until),
        updated_at = now()
  RETURNING *
  INTO v_row;

  IF p_provider_customer_id IS NOT NULL THEN
    INSERT INTO public.billing_customers (user_id, provider, provider_customer_id)
    VALUES (v_user_id, 'stripe', p_provider_customer_id)
    ON CONFLICT (provider, user_id)
    DO UPDATE
      SET provider_customer_id = excluded.provider_customer_id,
          updated_at = now();
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.subscribe_to_plan(
  public.subscription_plan,
  text, text, text, boolean,
  public.subscription_status,
  uuid, timestamptz
) TO authenticated, service_role;
