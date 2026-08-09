-- Add workspace limits per plan and allow multiple workspaces for paid users.

alter table if exists public.subscription_plans
  add column if not exists max_workspaces integer;

update public.subscription_plans
set max_workspaces = case code::text
  when 'free' then 1
  when 'pro' then 3
  when 'team' then 10
  when 'enterprise' then null
  else max_workspaces
end
where max_workspaces is null;

drop function if exists public.ensure_workspace_for_user(text);

create or replace function public.ensure_workspace_for_user(
  p_name text default 'Workspace',
  p_force_new boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_workspace_id uuid;
  v_plan public.subscription_plan;
  v_plan_text text;
  v_workspace_limit integer;
  v_owned_count integer;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Missing user id';
  end if;

  select plan into v_plan
  from public.user_subscriptions
  where user_id = v_user_id and status = 'active'
  order by created_at desc
  limit 1;

  if v_plan is null then
    select plan into v_plan
    from public.user_subscriptions
    where user_id = v_user_id
    order by created_at desc
    limit 1;
  end if;

  v_plan_text := coalesce(v_plan::text, 'free');

  if v_plan_text = 'free' then
    raise exception 'Active subscription required';
  end if;

  if not p_force_new then
    select wm.workspace_id into v_workspace_id
    from public.workspace_members wm
    where wm.user_id = v_user_id
    order by wm.created_at asc
    limit 1;

    if v_workspace_id is not null then
      return v_workspace_id;
    end if;
  end if;

  select max_workspaces
    into v_workspace_limit
  from public.subscription_plans
  where code::text = v_plan_text;

  if v_workspace_limit is not null then
    select count(*)
      into v_owned_count
    from public.workspaces
    where owner_id = v_user_id;

    if v_owned_count >= v_workspace_limit then
      raise exception 'Workspace limit reached for plan %', v_plan_text;
    end if;
  end if;

  insert into public.workspaces (name, owner_id)
  values (coalesce(nullif(p_name, ''), 'Workspace'), v_user_id)
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner'::public.workspace_role);

  return v_workspace_id;
end;
$$;

grant execute on function public.ensure_workspace_for_user(text, boolean) to authenticated, service_role;

create or replace function public.delete_workspace_for_user(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_owner_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized.');
  end if;

  select owner_id into v_owner_id
  from public.workspaces
  where id = p_workspace_id;

  if v_owner_id is null then
    return jsonb_build_object('success', false, 'error', 'Workspace not found.');
  end if;

  if v_owner_id <> v_user_id then
    return jsonb_build_object('success', false, 'error', 'Only workspace owners can delete workspaces.');
  end if;

  delete from public.workspaces
  where id = p_workspace_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_workspace_for_user(uuid) to authenticated, service_role;
