-- Add connection name to workspace query history entries.
alter table public.workspace_query_history
  add column if not exists connection_name text;
