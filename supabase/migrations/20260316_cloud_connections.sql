-- Encrypted cloud connections storage.

create table if not exists public.cloud_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  encrypted_connection text not null,
  iv text not null,
  salt text not null,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists idx_cloud_connections_user
  on public.cloud_connections (user_id);

alter table public.cloud_connections enable row level security;

drop policy if exists "cloud_connections_select" on public.cloud_connections;
create policy "cloud_connections_select"
on public.cloud_connections
for select
to authenticated
using (auth.uid() = user_id);

drop trigger if exists set_updated_at_cloud_connections on public.cloud_connections;
create trigger set_updated_at_cloud_connections
before update on public.cloud_connections
for each row execute function public.set_updated_at();

create or replace function public.save_cloud_connection(
  p_id uuid default null,
  p_name text,
  p_encrypted_connection text,
  p_iv text,
  p_salt text,
  p_sort_order integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Missing user id';
  end if;

  if p_id is null then
    insert into public.cloud_connections (user_id, name, encrypted_connection, iv, salt, sort_order)
    values (v_user_id, p_name, p_encrypted_connection, p_iv, p_salt, p_sort_order)
    on conflict (user_id, name) do update
      set encrypted_connection = excluded.encrypted_connection,
          iv = excluded.iv,
          salt = excluded.salt,
          sort_order = excluded.sort_order,
          updated_at = now()
    returning id into v_id;
  else
    insert into public.cloud_connections (id, user_id, name, encrypted_connection, iv, salt, sort_order)
    values (p_id, v_user_id, p_name, p_encrypted_connection, p_iv, p_salt, p_sort_order)
    on conflict (id) do update
      set name = excluded.name,
          encrypted_connection = excluded.encrypted_connection,
          iv = excluded.iv,
          salt = excluded.salt,
          sort_order = excluded.sort_order,
          updated_at = now()
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.save_cloud_connection(uuid, text, text, text, text, integer) to authenticated;

create or replace function public.delete_cloud_connection(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('success', false, 'error', 'Unauthorized.');
  end if;

  delete from public.cloud_connections
  where id = p_id
    and user_id = v_user_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_cloud_connection(uuid) to authenticated;
