create policy "workspace_snippet_folders_select" on public.workspace_snippet_folders
for select to authenticated
using (public.is_workspace_member(workspace_id));
