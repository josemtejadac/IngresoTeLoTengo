-- Horario de la tienda editable por el admin (Pedidos > "Horario de la tienda").
-- Antes el horario estaba escrito a mano en el codigo y en la funcion que crea pedidos. Ahora vive en estas tablas:
--   * ingreso_horario_tienda: abre/cierra de cada dia de la semana (0 = domingo ... 6 = sabado), o "cerrado todo el dia".
--   * ingreso_horario_excepciones: cambio solo para una fecha (ej. hoy cierra a las 21:00, o ese dia no se abre).
-- La funcion que crea los pedidos de clientes pasa a leer este horario (se parchea sola, abajo).
-- Si algo falla, no se cambia nada. Ejecutar UNA vez completo en el SQL Editor de Supabase. Es seguro repetirlo.

-- 1) Tablas (con el horario de siempre como punto de partida) ---------------------------------------------------
create table if not exists public.ingreso_horario_tienda (
  dow smallint primary key check (dow between 0 and 6),
  abre time not null default '08:30',
  cierra time not null default '22:50',
  cerrado boolean not null default false,
  updated_at timestamptz not null default now(),
  check (cerrado or cierra > abre)
);

insert into public.ingreso_horario_tienda (dow, abre, cierra) values
  (0, '08:30', '22:00'),
  (1, '08:30', '22:50'),
  (2, '08:30', '22:50'),
  (3, '08:30', '22:50'),
  (4, '08:30', '22:50'),
  (5, '08:30', '22:50'),
  (6, '09:00', '22:00')
on conflict (dow) do nothing;

create table if not exists public.ingreso_horario_excepciones (
  fecha date primary key,
  abre time,
  cierra time,
  cerrado boolean not null default false,
  created_at timestamptz not null default now(),
  check (cerrado or (abre is not null and cierra is not null and cierra > abre))
);

alter table public.ingreso_horario_tienda enable row level security;
alter table public.ingreso_horario_excepciones enable row level security;

-- Todos pueden ver el horario (los clientes lo necesitan); solo el admin lo cambia.
drop policy if exists ingreso_horario_tienda_select on public.ingreso_horario_tienda;
create policy ingreso_horario_tienda_select on public.ingreso_horario_tienda for select using (true);
drop policy if exists ingreso_horario_tienda_admin on public.ingreso_horario_tienda;
create policy ingreso_horario_tienda_admin on public.ingreso_horario_tienda
  for all using (public.ingreso_is_admin()) with check (public.ingreso_is_admin());

drop policy if exists ingreso_horario_excepciones_select on public.ingreso_horario_excepciones;
create policy ingreso_horario_excepciones_select on public.ingreso_horario_excepciones for select using (true);
drop policy if exists ingreso_horario_excepciones_admin on public.ingreso_horario_excepciones;
create policy ingreso_horario_excepciones_admin on public.ingreso_horario_excepciones
  for all using (public.ingreso_is_admin()) with check (public.ingreso_is_admin());

-- 2) Funciones ---------------------------------------------------------------------------------------------------
-- Horario de HOY (hora de Chile): primero el cambio puntual de la fecha, si no el del dia de la semana,
-- y si faltara todo, el horario de siempre.
create or replace function public.ingreso_tienda_horario_hoy()
returns table (abre_hoy time, cierra_hoy time, cerrado_hoy boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_ahora timestamp := now() at time zone 'America/Santiago';
  v_dow int := extract(dow from now() at time zone 'America/Santiago')::int;
  e record;
  h record;
begin
  select * into e from public.ingreso_horario_excepciones x where x.fecha = v_ahora::date;
  if found then
    return query select e.abre, e.cierra, e.cerrado;
    return;
  end if;
  select * into h from public.ingreso_horario_tienda t where t.dow = v_dow;
  if found then
    return query select h.abre, h.cierra, h.cerrado;
    return;
  end if;
  if v_dow = 0 then
    return query select '08:30'::time, '22:00'::time, false;
  elsif v_dow = 6 then
    return query select '09:00'::time, '22:00'::time, false;
  else
    return query select '08:30'::time, '22:50'::time, false;
  end if;
end $$;

create or replace function public.ingreso_tienda_abierta_ahora()
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_hora time := (now() at time zone 'America/Santiago')::time;
  v record;
begin
  select * into v from public.ingreso_tienda_horario_hoy();
  if v.cerrado_hoy then return false; end if;
  return v_hora >= v.abre_hoy and v_hora < v.cierra_hoy;
end $$;

create or replace function public.ingreso_tienda_mensaje_cierre()
returns text
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  select * into v from public.ingreso_tienda_horario_hoy();
  if v.cerrado_hoy then return 'La tienda está cerrada. Hoy no recibimos pedidos.'; end if;
  return 'La tienda está cerrada. Recibimos pedidos de '
    || extract(hour from v.abre_hoy)::int || ':' || to_char(v.abre_hoy, 'MI') || ' a '
    || extract(hour from v.cierra_hoy)::int || ':' || to_char(v.cierra_hoy, 'MI') || '.';
end $$;

-- Lo que lee la tienda de los clientes: una sola consulta con la semana y los cambios de hoy en adelante.
create or replace function public.ingreso_tienda_horario()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'semana', coalesce((
      select jsonb_agg(jsonb_build_object('dow', t.dow, 'abre', to_char(t.abre, 'HH24:MI'),
                                          'cierra', to_char(t.cierra, 'HH24:MI'), 'cerrado', t.cerrado) order by t.dow)
      from public.ingreso_horario_tienda t), '[]'::jsonb),
    'excepciones', coalesce((
      select jsonb_agg(jsonb_build_object('fecha', x.fecha, 'abre', to_char(x.abre, 'HH24:MI'),
                                          'cierra', to_char(x.cierra, 'HH24:MI'), 'cerrado', x.cerrado) order by x.fecha)
      from public.ingreso_horario_excepciones x
      where x.fecha >= (now() at time zone 'America/Santiago')::date), '[]'::jsonb)
  )
$$;

grant execute on function public.ingreso_tienda_horario() to anon, authenticated;

-- 3) La funcion que crea los pedidos de clientes lee este horario ------------------------------------------------
-- Se cambia SOLO el bloque del horario (antes escrito a mano) por una llamada a ingreso_tienda_abierta_ahora().
-- Todo lo demas de la funcion queda igual. Si no encuentra el bloque, avisa y no cambia nada.
do $patch$
declare
  d text;
  i_ini int;
  i_raise int;
  i_fin int;
begin
  select pg_get_functiondef('public.ingreso_crear_pedido_tienda(text,text,text,text,jsonb,text,numeric,text)'::regprocedure) into d;
  if position('ingreso_tienda_abierta_ahora' in d) > 0 then
    raise notice 'La funcion de pedidos ya usa el horario editable. No se cambio nada.';
    return;
  end if;
  i_ini := position($m$v_dow := extract(dow from (now() at time zone 'America/Santiago'))::int;$m$ in d);
  i_raise := position($m$raise exception 'La tienda está cerrada. Recibimos pedidos de % a %.', v_abre_txt, v_cierra_txt;$m$ in d);
  if i_ini = 0 or i_raise = 0 or i_raise < i_ini then
    raise exception 'No se encontro el bloque del horario en la funcion de pedidos. No se cambio nada.';
  end if;
  i_fin := i_raise + position('end if;' in substr(d, i_raise)) - 1 + length('end if;') - 1;
  d := substr(d, 1, i_ini - 1)
    || $n$if not public.ingreso_tienda_abierta_ahora() then
      raise exception '%', public.ingreso_tienda_mensaje_cierre();
    end if;$n$
    || substr(d, i_fin + 1);
  execute d;
  raise notice 'Listo: la funcion de pedidos ahora lee el horario editable.';
end
$patch$;

-- 4) Verificacion: debe mostrar el horario de hoy y "true" si la tienda esta abierta en este momento. -------------
select * from public.ingreso_tienda_horario_hoy();
select public.ingreso_tienda_abierta_ahora() as abierta_ahora;
