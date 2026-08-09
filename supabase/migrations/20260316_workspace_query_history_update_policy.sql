-- Allow updates for workspace query history to support upserts.
drop policy if exists "workspace_query_history_update" on public.workspace_query_history;

create policy "workspace_query_history_update" on public.workspace_query_history
for update to authenticated
using (public.is_workspace_member(workspace_id) and executed_by = auth.uid())
with check (public.is_workspace_member(workspace_id) and executed_by = auth.uid());
