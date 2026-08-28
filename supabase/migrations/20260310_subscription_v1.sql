-- Billing v1 foundation for plan catalog + Stripe-backed subscriptions.

create table if not exists public.subscription_plans (
  code public.subscription_plan primary key,
  name text not null,
  description text,
  monthly_price_cents integer not null default 0,
  yearly_price_cents integer,
  currency text not null default 'usd',
  cloud_enabled boolean not null default false,
  max_connections integer,
  monthly_query_limit bigint,
  monthly_storage_mb bigint,
  max_team_members integer,
  stripe_monthly_price_id text,
  stripe_yearly_price_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_customer_id),
  unique (provider, user_id)
);

create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists idx_subscription_plans_active
  on public.subscription_plans (is_active);

create index if not exists idx_billing_customers_user
  on public.billing_customers (user_id);

create index if not exists idx_webhook_events_unprocessed
  on public.billing_webhook_events (processed_at)
  where processed_at is null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_updated_at_subscription_plans on public.subscription_plans;
create trigger set_updated_at_subscription_plans
before update on public.subscription_plans
for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_billing_customers on public.billing_customers;
create trigger set_updated_at_billing_customers
before update on public.billing_customers
for each row execute function public.set_updated_at();

alter table public.subscription_plans enable row level security;
alter table public.billing_customers enable row level security;
alter table public.billing_webhook_events enable row level security;

drop policy if exists "Anyone can read active plans" on public.subscription_plans;
create policy "Anyone can read active plans"
on public.subscription_plans
for select
to authenticated, anon
using (is_active = true);

drop policy if exists "Users can read own billing customers" on public.billing_customers;
create policy "Users can read own billing customers"
on public.billing_customers
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.subscribe_to_plan(
  p_plan_code public.subscription_plan,
  p_interval text default 'month',
  p_provider_subscription_id text default null,
  p_provider_customer_id text default null,
  p_cancel_at_period_end boolean default false,
  p_status public.subscription_status default 'active',
  p_user_id uuid default auth.uid()
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_plan public.subscription_plans%rowtype;
  v_ends_at timestamptz;
  v_row public.user_subscriptions%rowtype;
begin
  v_user_id := coalesce(p_user_id, auth.uid());
  if v_user_id is null then
    raise exception 'Missing user id';
  end if;

  if p_interval not in ('month', 'year') then
    raise exception 'Invalid interval: %', p_interval;
  end if;

  select *
  into v_plan
  from public.subscription_plans
  where code = p_plan_code
    and is_active = true;

  if not found then
    raise exception 'Plan not found or inactive: %', p_plan_code;
  end if;

  v_ends_at := case
    when p_status = 'canceled' then now()
    when p_interval = 'year' then now() + interval '1 year'
    else now() + interval '1 month'
  end;

  insert into public.user_subscriptions (
    user_id,
    plan,
    status,
    started_at,
    ends_at,
    stripe_subscription_id
  )
  values (
    v_user_id,
    p_plan_code,
    p_status,
    now(),
    v_ends_at,
    p_provider_subscription_id
  )
  on conflict (user_id)
  do update
    set plan = excluded.plan,
        status = excluded.status,
        started_at = excluded.started_at,
        ends_at = excluded.ends_at,
        stripe_subscription_id = excluded.stripe_subscription_id,
        updated_at = now()
  returning *
  into v_row;

  if p_provider_customer_id is not null then
    insert into public.billing_customers (user_id, provider, provider_customer_id)
    values (v_user_id, 'stripe', p_provider_customer_id)
    on conflict (provider, user_id)
    do update
      set provider_customer_id = excluded.provider_customer_id,
          updated_at = now();
  end if;

  return v_row;
end;
$$;

create or replace function public.get_my_subscription()
returns public.user_subscriptions
language sql
stable
security definer
set search_path = public
as $$
  select us.*
  from public.user_subscriptions us
  where us.user_id = auth.uid()
  order by us.updated_at desc
  limit 1
$$;

grant execute on function public.subscribe_to_plan(
  public.subscription_plan,
  text,
  text,
  text,
  boolean,
  public.subscription_status,
  uuid
) to authenticated, service_role;

grant execute on function public.get_my_subscription() to authenticated, service_role;

insert into public.subscription_plans (
  code,
  name,
  description,
  monthly_price_cents,
  yearly_price_cents,
  currency,
  cloud_enabled,
  max_connections,
  monthly_query_limit,
  monthly_storage_mb,
  max_team_members,
  is_active
)
values
  ('free', 'Free', 'Local usage only, community support, no cloud features', 0, 0, 'usd', false, 3, null, null, 1, true),
  ('pro', 'Pro', 'Cloud enabled with higher limits, performance features, email support', 2900, 29000, 'usd', true, null, 100000, 10240, 1, true),
  ('team', 'Team', 'Cloud enabled with collaboration, roles, shared billing, integrations', 9900, 99000, 'usd', true, null, 500000, 51200, 10, true),
  ('enterprise', 'Enterprise', 'Cloud enabled with SSO/SAML, compliance, SLA, dedicated support', 0, null, 'usd', true, null, null, null, null, true)
on conflict (code)
do update
set name = excluded.name,
    description = excluded.description,
    monthly_price_cents = excluded.monthly_price_cents,
    yearly_price_cents = excluded.yearly_price_cents,
    currency = excluded.currency,
    cloud_enabled = excluded.cloud_enabled,
    max_connections = excluded.max_connections,
    monthly_query_limit = excluded.monthly_query_limit,
    monthly_storage_mb = excluded.monthly_storage_mb,
    max_team_members = excluded.max_team_members,
    is_active = excluded.is_active,
    updated_at = now();
