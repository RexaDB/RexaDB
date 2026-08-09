-- App error logging — client-side crash/error reporting
-- Allows the desktop app to send errors to Supabase for debugging

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  error_type text not null default 'unknown',
  message text,
  stack text,
  url text,
  component_stack text,
  metadata jsonb default '{}'::jsonb,
  app_version text,
  os text,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_errors_created_at on public.app_errors (created_at desc);
create index if not exists idx_app_errors_user_id on public.app_errors (user_id);
create index if not exists idx_app_errors_error_type on public.app_errors (error_type);

alter table public.app_errors enable row level security;

-- Only service_role can read all errors
create policy "app_errors_service_select"
on public.app_errors
for select
to service_role
using (true);

-- Only service_role can insert via the RPC function below
create policy "app_errors_service_insert"
on public.app_errors
for insert
to service_role
with check (true);

-- Users can view their own errors
create policy "app_errors_self_select"
on public.app_errors
for select
to authenticated
using (auth.uid() = user_id);

create or replace function public.log_app_error(
  p_error_type text default 'unknown',
  p_message text default null,
  p_stack text default null,
  p_url text default null,
  p_component_stack text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_app_version text default null,
  p_os text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_total_size bigint;
  v_id uuid;
  v_max_bytes constant bigint := 51200;
begin
  v_total_size :=
    coalesce(octet_length(p_error_type), 0) +
    coalesce(octet_length(p_message), 0) +
    coalesce(octet_length(p_stack), 0) +
    coalesce(octet_length(p_url), 0) +
    coalesce(octet_length(p_component_stack), 0) +
    coalesce(octet_length(p_metadata::text), 0) +
    coalesce(octet_length(p_app_version), 0) +
    coalesce(octet_length(p_os), 0);

  if v_total_size > v_max_bytes then
    raise exception 'Error payload too large: % bytes (max %)', v_total_size, v_max_bytes;
  end if;

  begin
    v_user_id := auth.uid();
  exception
    when others then
      v_user_id := null;
  end;

  insert into public.app_errors (
    user_id, error_type, message, stack, url,
    component_stack, metadata, app_version, os
  ) values (
    v_user_id, p_error_type, p_message, p_stack, p_url,
    p_component_stack, p_metadata, p_app_version, p_os
  ) returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.log_app_error(
  text, text, text, text, text, jsonb, text, text
) to anon, authenticated, service_role;
