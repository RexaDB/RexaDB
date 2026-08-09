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
  values (v_workspace_id, v_user_id, 'owner'::public.workspace_role);

  return v_workspace_id;
end;
$$;

grant execute on function public.ensure_workspace_for_user(text) to authenticated, service_role;

create or replace function public.accept_workspace_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite record;
  v_plan public.subscription_plan;
  v_plan_text text;
  v_member_limit integer;
  v_member_count integer;
begin
  if v_user is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized.');
  end if;

  select *
    into v_invite
  from workspace_invites
  where id = p_invite_id
    and invited_user_id = v_user
    and status = 'pending';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invite not found.');
  end if;

  if exists (
    select 1 from workspace_members
    where workspace_id = v_invite.workspace_id
      and user_id = v_user
  ) then
    update workspace_invites
      set status = 'accepted', responded_at = now()
    where id = p_invite_id;
    return jsonb_build_object('success', true);
  end if;

  select plan
    into v_plan
  from user_subscriptions
  where user_id = (select owner_id from workspaces where id = v_invite.workspace_id)
    and status = 'active'
  order by created_at desc
  limit 1;

  v_plan_text := coalesce(v_plan::text, 'free');

  select max_team_members
    into v_member_limit
  from subscription_plans
  where code::text = v_plan_text;

  if v_plan_text in ('team', 'enterprise') then
    v_member_limit := null;
  end if;

  if v_member_limit is not null then
    select count(*)
      into v_member_count
    from workspace_members
    where workspace_id = v_invite.workspace_id;

    if v_member_count >= v_member_limit then
      return jsonb_build_object('success', false, 'error', 'Team member limit reached for this plan.');
    end if;
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_user, v_invite.role::public.workspace_role);

  update workspace_invites
    set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.accept_workspace_invite(uuid) to authenticated;
