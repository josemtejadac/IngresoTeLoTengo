-- Subcategorias (ej. HALLOWEEN -> Caramelos / Gomitas / Chupetes). Se editan en Inventario (admin y quien puede
-- editar productos). La tienda las muestra al abrir una categoria que las tenga. Ejecutar una vez en el SQL Editor.
alter table public.ingreso_productos add column if not exists subcategoria text;

-- Para la tienda (publica): solo id y subcategoria de los productos activos que tienen una.
create or replace function public.ingreso_tienda_subcategorias()
returns table(id uuid, subcategoria text)
language sql stable security definer set search_path to 'public' as $$
  select id, subcategoria from ingreso_productos
  where active and precio is not null and precio > 0 and subcategoria is not null and trim(subcategoria) <> ''
$$;
grant execute on function public.ingreso_tienda_subcategorias() to anon, authenticated;
