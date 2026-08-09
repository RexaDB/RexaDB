create or replace function public.ensure_workspace_for_user(p_name text default 'Workspace')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_workspace_id uuid;
  v_plan public.subscription_plan;
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

  if v_plan is null or v_plan::text = 'free' then
    raise exception 'Active subscription required';
  end if;

  select wm.workspace_id into v_workspace_id
  from public.workspace_members wm
  where wm.user_id = v_user_id
  order by wm.created_at asc
  limit 1;

  if v_workspace_id is not null then
    return v_workspace_id;
  end if;

  insert into public.workspaces (name, owner_id)
  values (coalesce(nullif(p_name, ''), 'Workspace'), v_user_id)
  returning id into v_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace_id, v_user_id, 'owner');

  return v_workspace_id;
end;
$$;

grant execute on function public.ensure_workspace_for_user(text) to authenticated, service_role;
