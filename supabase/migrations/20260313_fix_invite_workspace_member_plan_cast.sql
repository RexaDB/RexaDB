create or replace function public.invite_workspace_member(
  p_workspace_id uuid,
  p_email text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester uuid := auth.uid();
  v_workspace record;
  v_role text;
  v_plan public.subscription_plan;
  v_plan_text text;
  v_member_limit integer;
  v_member_count integer;
  v_target_user uuid;
begin
  if v_requester is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized.');
  end if;

  select id, owner_id
    into v_workspace
  from workspaces
  where id = p_workspace_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Workspace not found.');
  end if;

  select role
    into v_role
  from workspace_members
  where workspace_id = p_workspace_id
    and user_id = v_requester;

  if v_role is null or v_role not in ('owner', 'admin') then
    return jsonb_build_object('success', false, 'error', 'Only workspace admins can add members.');
  end if;

  select plan
    into v_plan
  from user_subscriptions
  where user_id = v_workspace.owner_id
    and status = 'active'
  order by created_at desc
  limit 1;

  if v_plan is null then
    select plan
      into v_plan
    from user_subscriptions
    where user_id = v_workspace.owner_id
    order by created_at desc
    limit 1;
  end if;

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
    where workspace_id = p_workspace_id;

    if v_member_count >= v_member_limit then
      return jsonb_build_object('success', false, 'error', 'Team member limit reached for this plan.');
    end if;
  end if;

  if p_user_id is not null then
    v_target_user := p_user_id;
  else
    if p_email is null or length(trim(p_email)) = 0 then
      return jsonb_build_object('success', false, 'error', 'Missing member email or user id.');
    end if;

    select id
      into v_target_user
    from profiles
    where lower(email) = lower(p_email)
    limit 1;
  end if;

  if v_target_user is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (p_workspace_id, v_target_user, 'member')
  on conflict (workspace_id, user_id) do nothing;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.invite_workspace_member(uuid, text, uuid) to authenticated;
