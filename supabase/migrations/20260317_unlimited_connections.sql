-- Make all paid plans unlimited connections (null = unlimited in entitlement logic)
-- Covers existing databases that already applied 20260310/20260311 with 25/100 limits

update public.subscription_plans
set max_connections = null,
    updated_at = now()
where code::text in ('pro', 'team', 'enterprise', 'otl')
  and max_connections is not null;
