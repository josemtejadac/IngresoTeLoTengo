-- Tienda: datos de cada promo activa para mostrarla bien (que productos incluye, con su foto, y cuanto
-- costarian comprados por separado, para mostrar el ahorro). Solo lectura. Ejecutar una vez en el SQL Editor.
create or replace function public.ingreso_tienda_promos()
returns table(promo_id uuid, precio_separado numeric, incluye jsonb)
language sql stable security definer set search_path to 'public' as $$
  select pr.id,
         coalesce(sum(ingreso_precio_con_descuento(p.precio, p.descuento_pct) * c.cantidad), 0),
         jsonb_agg(jsonb_build_object('nombre', p.nombre, 'cantidad', c.cantidad, 'foto_path', p.foto_path) order by p.nombre)
  from ingreso_productos pr
  join ingreso_promo_componentes c on c.promo_id = pr.id
  join ingreso_productos p on p.id = c.producto_id
  where pr.es_promo and pr.active
  group by pr.id
$$;
grant execute on function public.ingreso_tienda_promos() to anon, authenticated;
