-- Fix RLS insert/update/delete for workspace folders (snippet + dashboard)

-- Snippet folders
drop policy if exists "workspace_snippet_folders_insert" on public.workspace_snippet_folders;
create policy "workspace_snippet_folders_insert" on public.workspace_snippet_folders
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_snippet_folders_update" on public.workspace_snippet_folders;
create policy "workspace_snippet_folders_update" on public.workspace_snippet_folders
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_snippet_folders_delete" on public.workspace_snippet_folders;
create policy "workspace_snippet_folders_delete" on public.workspace_snippet_folders
for delete to authenticated
using (public.is_workspace_member(workspace_id));

-- Dashboard folders
drop policy if exists "workspace_dashboard_folders_insert" on public.workspace_dashboard_folders;
create policy "workspace_dashboard_folders_insert" on public.workspace_dashboard_folders
for insert to authenticated
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_dashboard_folders_update" on public.workspace_dashboard_folders;
create policy "workspace_dashboard_folders_update" on public.workspace_dashboard_folders
for update to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_dashboard_folders_delete" on public.workspace_dashboard_folders;
create policy "workspace_dashboard_folders_delete" on public.workspace_dashboard_folders
for delete to authenticated
using (public.is_workspace_member(workspace_id));
