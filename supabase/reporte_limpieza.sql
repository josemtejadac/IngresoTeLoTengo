-- Reporte de limpieza: foto comprimida + nota, visible para todo el equipo.
-- Incluye solicitudes de limpieza que crea el admin y los trabajadores completan subiendo un reporte.

create table if not exists public.ingreso_tareas_limpieza (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  creada_por uuid not null references public.ingreso_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  completada_por uuid references public.ingreso_profiles(id) on delete set null,
  completada_at timestamptz
);
alter table public.ingreso_tareas_limpieza enable row level security;
create policy ingreso_tareas_select on public.ingreso_tareas_limpieza for select to authenticated
  using (exists (select 1 from public.ingreso_profiles where id = auth.uid()));
create policy ingreso_tareas_admin_insert on public.ingreso_tareas_limpieza for insert to authenticated
  with check (public.ingreso_is_admin() and creada_por = auth.uid());
create policy ingreso_tareas_admin_delete on public.ingreso_tareas_limpieza for delete to authenticated
  using (public.ingreso_is_admin());
alter publication supabase_realtime add table public.ingreso_tareas_limpieza;
create table if not exists public.ingreso_reportes_limpieza (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.ingreso_profiles(id) on delete cascade,
  nota text not null check (length(trim(nota)) > 0),
  foto_path text not null,
  tarea_id uuid references public.ingreso_tareas_limpieza(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.ingreso_reportes_limpieza enable row level security;

create policy ingreso_limpieza_select on public.ingreso_reportes_limpieza for select to authenticated
  using (exists (select 1 from public.ingreso_profiles where id = auth.uid()));
create policy ingreso_limpieza_insert on public.ingreso_reportes_limpieza for insert to authenticated
  with check (worker_id = auth.uid());
create policy ingreso_limpieza_admin_delete on public.ingreso_reportes_limpieza for delete to authenticated
  using (public.ingreso_is_admin());

alter publication supabase_realtime add table public.ingreso_reportes_limpieza;

insert into storage.buckets (id, name, public) values ('ingreso-limpieza', 'ingreso-limpieza', false)
  on conflict (id) do nothing;

create policy ingreso_limpieza_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ingreso-limpieza' and (storage.foldername(name))[1] = auth.uid()::text);
create policy ingreso_limpieza_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'ingreso-limpieza'
         and exists (select 1 from public.ingreso_profiles where id = auth.uid()));
create policy ingreso_limpieza_obj_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ingreso-limpieza' and public.ingreso_is_admin());

-- Al subir un reporte ligado a una solicitud, la solicitud queda completada por quien lo subio.
create or replace function public.ingreso_reporte_completa_tarea()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tarea_id is not null then
    update ingreso_tareas_limpieza
       set completada_por = new.worker_id, completada_at = now()
     where id = new.tarea_id and completada_at is null;
  end if;
  return new;
end $$;
create trigger ingreso_reporte_completa_tarea after insert on public.ingreso_reportes_limpieza
  for each row execute function public.ingreso_reporte_completa_tarea();
