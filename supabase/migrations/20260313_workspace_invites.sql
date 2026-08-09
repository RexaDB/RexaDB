create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  invited_user_id uuid not null references public.profiles(id) on delete cascade,
  email text,
  role text not null default 'member',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create unique index if not exists workspace_invites_pending_unique
  on public.workspace_invites (workspace_id, invited_user_id)
  where status = 'pending';

create index if not exists workspace_invites_user_idx
  on public.workspace_invites (invited_user_id, status, created_at desc);

alter table public.workspace_invites enable row level security;

create policy "workspace_invites_select_invited"
  on public.workspace_invites
  for select to authenticated
  using (invited_user_id = auth.uid());

create policy "workspace_invites_select_admins"
  on public.workspace_invites
  for select to authenticated
  using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = workspace_id
        and wm.user_id = auth.uid()
        and wm.role in ('owner', 'admin')
    )
  );

-- Invitations are inserted/updated via security definer RPCs.

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
  v_pending_count integer;
  v_target_user uuid;
  v_target_email text;
  v_invite_id uuid;
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

    select count(*)
      into v_pending_count
    from workspace_invites
    where workspace_id = p_workspace_id
      and status = 'pending';

    if (v_member_count + v_pending_count) >= v_member_limit then
      return jsonb_build_object('success', false, 'error', 'Team member limit reached for this plan.');
    end if;
  end if;

  if p_user_id is not null then
    v_target_user := p_user_id;
    select email into v_target_email from profiles where id = v_target_user;
  else
    if p_email is null or length(trim(p_email)) = 0 then
      return jsonb_build_object('success', false, 'error', 'Missing member email or user id.');
    end if;

    select id, email
      into v_target_user, v_target_email
    from profiles
    where lower(email) = lower(p_email)
    limit 1;
  end if;

  if v_target_user is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  if exists (
    select 1 from workspace_members
    where workspace_id = p_workspace_id
      and user_id = v_target_user
  ) then
    return jsonb_build_object('success', false, 'error', 'User is already a workspace member.');
  end if;

  insert into workspace_invites (workspace_id, invited_by, invited_user_id, email, role, status)
  values (p_workspace_id, v_requester, v_target_user, v_target_email, 'member', 'pending')
  on conflict (workspace_id, invited_user_id)
  where status = 'pending'
  do update set created_at = now()
  returning id into v_invite_id;

  insert into notifications (user_id, notification_key, type, title, body, metadata)
  values (
    v_target_user,
    'workspace_invite:' || v_invite_id::text,
    'workspace_invite',
    'Workspace invite',
    format('You have been invited to join %s', coalesce((select name from workspaces where id = p_workspace_id), 'a workspace')),
    jsonb_build_object('workspace_id', p_workspace_id, 'invite_id', v_invite_id)
  )
  on conflict (user_id, notification_key) do nothing;

  return jsonb_build_object('success', true, 'invite_id', v_invite_id);
end;
$$;

grant execute on function public.invite_workspace_member(uuid, text, uuid) to authenticated;

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
  values (v_invite.workspace_id, v_user, v_invite.role);

  update workspace_invites
    set status = 'accepted', responded_at = now()
  where id = p_invite_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.accept_workspace_invite(uuid) to authenticated;

create or replace function public.decline_workspace_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized.');
  end if;

  update workspace_invites
    set status = 'declined', responded_at = now()
  where id = p_invite_id
    and invited_user_id = v_user
    and status = 'pending';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invite not found.');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.decline_workspace_invite(uuid) to authenticated;
