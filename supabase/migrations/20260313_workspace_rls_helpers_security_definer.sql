-- Ensure workspace RLS helper functions bypass RLS on workspace_members to avoid recursion.

create or replace function public.is_workspace_member(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public.is_workspace_admin(p_workspace_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = coalesce(p_user_id, auth.uid())
      and wm.role in ('owner','admin')
  );
$$;
