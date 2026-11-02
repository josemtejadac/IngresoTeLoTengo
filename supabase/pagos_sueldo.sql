-- Pago de sueldos: en el Historial de pagos el admin marca cada mes (o semana) como pagado, por TRANSFERENCIA
-- (adjuntando la captura) o en EFECTIVO. El trabajador ve el check de "Pagado" en su propio historial.
-- Las capturas se guardan muy comprimidas en el bucket privado ingreso-comprobantes, carpeta sueldos/<trabajador>/.
-- Ejecutar una sola vez en el SQL Editor de Supabase.

create table if not exists public.ingreso_pagos_sueldo (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.ingreso_profiles(id) on delete cascade,
  -- Mes: '2026-10'. Semana: 'S2026-10-26' (fecha del lunes).
  periodo text not null,
  metodo text not null check (metodo in ('transferencia', 'efectivo')),
  comprobante_path text,
  monto numeric,
  pagado_at timestamptz not null default now(),
  pagado_por uuid default auth.uid(),
  unique (worker_id, periodo)
);

alter table public.ingreso_pagos_sueldo enable row level security;

drop policy if exists ingreso_pagos_sueldo_select on public.ingreso_pagos_sueldo;
create policy ingreso_pagos_sueldo_select on public.ingreso_pagos_sueldo
  for select using (public.ingreso_is_admin() or worker_id = auth.uid());

drop policy if exists ingreso_pagos_sueldo_admin_write on public.ingreso_pagos_sueldo;
create policy ingreso_pagos_sueldo_admin_write on public.ingreso_pagos_sueldo
  for all using (public.ingreso_is_admin()) with check (public.ingreso_is_admin());

-- Capturas (solo la carpeta sueldos/ del bucket): el admin sube, ve y borra; el trabajador ve las suyas.
drop policy if exists ingreso_sueldos_obj_admin_insert on storage.objects;
create policy ingreso_sueldos_obj_admin_insert on storage.objects
  for insert with check (bucket_id = 'ingreso-comprobantes' and (storage.foldername(name))[1] = 'sueldos' and public.ingreso_is_admin());

drop policy if exists ingreso_sueldos_obj_admin_select on storage.objects;
create policy ingreso_sueldos_obj_admin_select on storage.objects
  for select using (bucket_id = 'ingreso-comprobantes' and (storage.foldername(name))[1] = 'sueldos' and public.ingreso_is_admin());

drop policy if exists ingreso_sueldos_obj_admin_delete on storage.objects;
create policy ingreso_sueldos_obj_admin_delete on storage.objects
  for delete using (bucket_id = 'ingreso-comprobantes' and (storage.foldername(name))[1] = 'sueldos' and public.ingreso_is_admin());

drop policy if exists ingreso_sueldos_obj_own_select on storage.objects;
create policy ingreso_sueldos_obj_own_select on storage.objects
  for select using (bucket_id = 'ingreso-comprobantes' and (storage.foldername(name))[1] = 'sueldos' and (storage.foldername(name))[2] = auth.uid()::text);
