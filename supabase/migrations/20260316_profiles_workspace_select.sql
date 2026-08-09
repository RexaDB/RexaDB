-- Allow authenticated users to read profiles of users who share a workspace.

drop policy if exists "workspace_profile_select" on public.profiles;

create policy "workspace_profile_select"
on public.profiles
for select
to authenticated
using (
  auth.uid() = id
  or exists (
    select 1
    from public.workspace_members wm_self
    join public.workspace_members wm_other
      on wm_self.workspace_id = wm_other.workspace_id
    where wm_self.user_id = auth.uid()
      and wm_other.user_id = profiles.id
  )
);
