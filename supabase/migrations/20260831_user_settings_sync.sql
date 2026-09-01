-- Cloud sync for paid-plan user preferences (themes, studio settings, keybindings).
-- Gated client-side by entitlement.cloudEnabled; RLS keeps rows per-user.

create table if not exists public.user_settings_sync (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  client_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_settings_sync_updated
  on public.user_settings_sync (updated_at desc);

alter table public.user_settings_sync enable row level security;

drop policy if exists "user_settings_sync_select" on public.user_settings_sync;
create policy "user_settings_sync_select"
on public.user_settings_sync
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_settings_sync_insert" on public.user_settings_sync;
create policy "user_settings_sync_insert"
on public.user_settings_sync
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_settings_sync_update" on public.user_settings_sync;
create policy "user_settings_sync_update"
on public.user_settings_sync
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_settings_sync_delete" on public.user_settings_sync;
create policy "user_settings_sync_delete"
on public.user_settings_sync
for delete
to authenticated
using (auth.uid() = user_id);

drop trigger if exists set_updated_at_user_settings_sync on public.user_settings_sync;
create trigger set_updated_at_user_settings_sync
before update on public.user_settings_sync
for each row execute function public.set_updated_at();

-- Upsert with last-write-wins on client_updated_at.
-- Returns the row that won (either the newly written payload or the existing newer one).
create or replace function public.save_user_settings_sync(
  p_payload jsonb,
  p_client_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.user_settings_sync%rowtype;
  v_result public.user_settings_sync%rowtype;
begin
  if v_user_id is null then
    raise exception 'Missing user id';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid settings payload';
  end if;

  if p_client_updated_at is null then
    raise exception 'Missing client_updated_at';
  end if;

  select * into v_existing
  from public.user_settings_sync
  where user_id = v_user_id;

  if found and v_existing.client_updated_at > p_client_updated_at then
    -- Remote is newer; caller should apply this instead of overwriting.
    return jsonb_build_object(
      'applied', false,
      'user_id', v_existing.user_id,
      'payload', v_existing.payload,
      'client_updated_at', v_existing.client_updated_at,
      'updated_at', v_existing.updated_at
    );
  end if;

  insert into public.user_settings_sync (user_id, payload, client_updated_at)
  values (v_user_id, p_payload, p_client_updated_at)
  on conflict (user_id) do update
    set payload = excluded.payload,
        client_updated_at = excluded.client_updated_at,
        updated_at = now()
  returning * into v_result;

  return jsonb_build_object(
    'applied', true,
    'user_id', v_result.user_id,
    'payload', v_result.payload,
    'client_updated_at', v_result.client_updated_at,
    'updated_at', v_result.updated_at
  );
end;
$$;

grant execute on function public.save_user_settings_sync(jsonb, timestamptz) to authenticated;
