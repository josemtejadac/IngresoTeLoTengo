-- Promos de varios productos (ej. harina + jamon + queso con un precio propio).
-- La promo es un producto mas del inventario (nombre, precio, foto, categoria). Su stock se calcula solo
-- (cuantas promos alcanzan con el stock de sus productos) y al venderla se descuenta de cada producto.
-- Ejecutar una sola vez en el SQL Editor de Supabase.

alter table public.ingreso_productos add column if not exists es_promo boolean not null default false;

create table if not exists public.ingreso_promo_componentes (
  promo_id uuid not null references public.ingreso_productos(id) on delete cascade,
  producto_id uuid not null references public.ingreso_productos(id),
  cantidad integer not null check (cantidad > 0),
  primary key (promo_id, producto_id)
);
alter table public.ingreso_promo_componentes enable row level security;
drop policy if exists ingreso_promo_componentes_select on public.ingreso_promo_componentes;
create policy ingreso_promo_componentes_select on public.ingreso_promo_componentes
  for select using (auth.uid() is not null);

-- Cuantas promos se pueden armar con el stock actual de sus productos (el que menos alcanza manda).
create or replace function public.ingreso_promo_stock_calculado(p_promo uuid)
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce(min(floor(coalesce(b.stock, 0)::numeric
           / (c.cantidad * greatest(coalesce(p.unidades_por_producto, 1), 1)))), 0)::integer
  from ingreso_promo_componentes c
  join ingreso_productos p on p.id = c.producto_id
  join ingreso_productos b on b.id = coalesce(p.stock_base_producto_id, p.id)
  where c.promo_id = p_promo
$$;

-- Recalcula el stock de las promos que usan el producto (base) indicado.
create or replace function public.ingreso_promo_recalcular(p_base uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform set_config('tlt.promo_sync', '1', true);
  update ingreso_productos pr
     set stock = ingreso_promo_stock_calculado(pr.id), updated_at = now()
   where pr.es_promo
     and pr.stock is distinct from ingreso_promo_stock_calculado(pr.id)
     and exists (
       select 1 from ingreso_promo_componentes c
       join ingreso_productos p on p.id = c.producto_id
       where c.promo_id = pr.id and coalesce(p.stock_base_producto_id, p.id) = p_base);
  perform set_config('tlt.promo_sync', '', true);
end $$;

-- Si cambia el stock de una promo (se vendio / se devolvio), el cambio pasa a cada producto que la compone.
-- Si cambia el stock de un producto, se recalcula el de las promos que lo usan.
create or replace function public.ingreso_promo_stock_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  r record;
  v_delta integer;
begin
  if coalesce(current_setting('tlt.promo_sync', true), '') = '1' then return new; end if;
  if new.stock is not distinct from old.stock then return new; end if;

  if new.es_promo then
    v_delta := new.stock - old.stock;
    for r in
      select coalesce(p.stock_base_producto_id, p.id) as objetivo,
             c.cantidad * greatest(coalesce(p.unidades_por_producto, 1), 1) as por_promo
        from ingreso_promo_componentes c
        join ingreso_productos p on p.id = c.producto_id
       where c.promo_id = new.id
    loop
      update ingreso_productos
         set stock = greatest(0, stock + v_delta * r.por_promo), updated_at = now()
       where id = r.objetivo;
    end loop;
    perform set_config('tlt.promo_sync', '1', true);
    update ingreso_productos set stock = ingreso_promo_stock_calculado(new.id) where id = new.id;
    perform set_config('tlt.promo_sync', '', true);
  elsif new.stock_base_producto_id is null then
    perform ingreso_promo_recalcular(new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_ingreso_promo_stock on public.ingreso_productos;
create trigger trg_ingreso_promo_stock after update of stock on public.ingreso_productos
  for each row execute function public.ingreso_promo_stock_trg();

-- Crear o editar una promo (varios productos con un precio propio). p_id null = crear.
create or replace function public.ingreso_guardar_promo(
  p_id uuid, p_nombre text, p_categoria text, p_precio numeric, p_items jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid := p_id;
  v_item jsonb;
  v_prod record;
  v_cant integer;
  v_nota text := '';
  v_vistos uuid[] := '{}';
begin
  if not public.ingreso_puede_editar_productos() then raise exception 'No tienes permiso para crear promos'; end if;
  if p_nombre is null or length(trim(p_nombre)) < 2 then raise exception 'Falta el nombre de la promo'; end if;
  if p_precio is null or p_precio <= 0 then raise exception 'Pon el precio de la promo'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 2 then
    raise exception 'Una promo necesita al menos 2 productos';
  end if;

  if v_id is not null then
    perform 1 from ingreso_productos where id = v_id and es_promo for update;
    if not found then raise exception 'Promo no encontrada'; end if;
  end if;

  -- Validar los productos antes de tocar nada.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_cant := (v_item->>'cantidad')::integer;
    if v_cant is null or v_cant <= 0 or v_cant > 1000 then raise exception 'Cantidad invalida en la promo'; end if;
    select * into v_prod from ingreso_productos where id = (v_item->>'producto_id')::uuid;
    if not found then raise exception 'Producto no encontrado'; end if;
    if v_prod.es_promo then raise exception 'Una promo no puede incluir otra promo'; end if;
    if v_prod.por_peso then raise exception '% se vende por peso y no se puede meter en una promo', v_prod.nombre; end if;
    if v_prod.id = any(v_vistos) then raise exception '% esta repetido en la promo', v_prod.nombre; end if;
    v_vistos := v_vistos || v_prod.id;
    v_nota := v_nota || case when v_nota = '' then '' else ', ' end || v_cant || ' x ' || initcap(lower(v_prod.nombre));
  end loop;

  if v_id is null then
    insert into ingreso_productos (nombre, categoria, precio, stock, active, es_promo, nota)
    values (upper(trim(p_nombre)), nullif(trim(coalesce(p_categoria, '')), ''), p_precio, 0, true, true, 'Incluye: ' || v_nota)
    returning id into v_id;
  else
    update ingreso_productos
       set nombre = upper(trim(p_nombre)), categoria = nullif(trim(coalesce(p_categoria, '')), ''),
           precio = p_precio, updated_at = now(),
           nota = case when nota is null or nota like 'Incluye:%' then 'Incluye: ' || v_nota else nota end
     where id = v_id;
    delete from ingreso_promo_componentes where promo_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into ingreso_promo_componentes (promo_id, producto_id, cantidad)
    values (v_id, (v_item->>'producto_id')::uuid, (v_item->>'cantidad')::integer);
  end loop;

  perform set_config('tlt.promo_sync', '1', true);
  update ingreso_productos set stock = ingreso_promo_stock_calculado(v_id), updated_at = now() where id = v_id;
  perform set_config('tlt.promo_sync', '', true);
  return v_id;
end $$;
revoke all on function public.ingreso_guardar_promo(uuid, text, text, numeric, jsonb) from public, anon;
grant execute on function public.ingreso_guardar_promo(uuid, text, text, numeric, jsonb) to authenticated;

-- El stock de una promo se calcula solo: no se edita a mano ni se carga por factura.
create or replace function public.ingreso_worker_actualizar_precio_stock(p_id uuid, p_precio numeric, p_stock integer)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_base uuid; v_promo boolean;
begin
  if not public.ingreso_puede_editar_productos() then raise exception 'No tienes permiso para editar productos'; end if;
  if p_precio is not null and p_precio < 0 then raise exception 'El precio no puede ser negativo'; end if;
  if p_stock is null or p_stock < 0 then raise exception 'El stock no puede ser negativo'; end if;

  select stock_base_producto_id, es_promo into v_base, v_promo from ingreso_productos where id = p_id;
  if v_base is not null or v_promo then
    update ingreso_productos set precio = p_precio, updated_at = now() where id = p_id;
  else
    update ingreso_productos set precio = p_precio, stock = p_stock, updated_at = now() where id = p_id;
  end if;
end $$;

create or replace function public.ingreso_sumar_stock(p_id uuid, p_cantidad integer)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_nuevo integer; v_base uuid; v_promo boolean;
begin
  if not public.ingreso_puede_cargar_facturas() then
    raise exception 'No tienes permiso para cargar facturas';
  end if;
  if p_cantidad is null or p_cantidad = 0 or abs(p_cantidad) > 100000 then raise exception 'Cantidad invalida'; end if;
  select stock_base_producto_id, es_promo into v_base, v_promo from ingreso_productos where id = p_id;
  if v_promo then
    raise exception 'Una promo no lleva factura: agrega la factura a cada producto que la compone.';
  end if;
  if v_base is not null then
    raise exception 'Este producto comparte stock con otro: agrega la factura al producto base, no a este.';
  end if;
  update ingreso_productos set stock = greatest(0, stock + p_cantidad), active = true, updated_at = now()
   where id = p_id returning stock into v_nuevo;
  if v_nuevo is null then raise exception 'Producto no encontrado'; end if;
  return v_nuevo;
end $$;

-- Arreglo: al agregar un PACK a un pedido ya hecho se guardaban paquetes en vez de unidades, y al quitarlo
-- o cancelar el pedido se devolvia menos stock del que se desconto. Ahora se guardan las unidades reales,
-- igual que cuando el cliente compra el pack desde la tienda.
create or replace function public.ingreso_agregar_item_pedido(p_pedido uuid, p_producto uuid, p_cantidad integer, p_es_combo boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_pedido record;
  v_prod record;
  v_existente record;
  v_precio numeric;
  v_subtotal numeric;
  v_stock_a_descontar int;
  v_cantidad_item int;
  v_objetivo_id uuid;
  v_stock_objetivo int;
begin
  if auth.uid() is null then
    raise exception 'No autorizado';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Cantidad invalida';
  end if;

  select * into v_pedido from ingreso_pedidos_tienda where id = p_pedido for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v_pedido.estado in ('entregado','cancelado') then
    raise exception 'Este pedido ya no se puede modificar';
  end if;

  select * into v_prod from ingreso_productos where id = p_producto for update;
  if not found then raise exception 'Producto no encontrado'; end if;
  if not v_prod.active or v_prod.precio is null then
    raise exception 'Ese producto no esta disponible';
  end if;
  if v_prod.por_peso then
    raise exception 'Los productos por peso no se pueden agregar asi, usa el pedido manual';
  end if;

  v_objetivo_id := coalesce(v_prod.stock_base_producto_id, v_prod.id);

  if p_es_combo then
    if v_prod.combo_cantidad is null or v_prod.combo_precio is null then
      raise exception 'Ese producto no tiene precio por pack';
    end if;
    v_stock_a_descontar := p_cantidad * v_prod.combo_cantidad;
    v_cantidad_item := v_stock_a_descontar;
    v_precio := v_prod.combo_precio;
    v_subtotal := p_cantidad * v_prod.combo_precio;
  else
    v_stock_a_descontar := p_cantidad * coalesce(v_prod.unidades_por_producto, 1);
    v_cantidad_item := p_cantidad;
    v_precio := ingreso_precio_con_descuento(v_prod.precio, v_prod.descuento_pct);
    v_subtotal := p_cantidad * v_precio;
  end if;

  select stock into v_stock_objetivo from ingreso_productos where id = v_objetivo_id for update;
  if v_stock_objetivo < v_stock_a_descontar then
    raise exception 'No hay stock suficiente de %', v_prod.nombre;
  end if;

  select * into v_existente from ingreso_pedidos_tienda_items
   where pedido_id = p_pedido and producto_id = p_producto and es_combo = p_es_combo
   for update;

  if v_existente.id is not null then
    update ingreso_pedidos_tienda_items
       set cantidad = cantidad + v_cantidad_item, subtotal = subtotal + v_subtotal
     where id = v_existente.id;
  else
    insert into ingreso_pedidos_tienda_items
      (pedido_id, producto_id, nombre_producto, precio_unitario, cantidad, subtotal, es_peso, es_combo)
    values
      (p_pedido, p_producto, v_prod.nombre, v_precio, v_cantidad_item, v_subtotal, false, p_es_combo);
  end if;

  update ingreso_productos set stock = stock - v_stock_a_descontar, updated_at = now() where id = v_objetivo_id;
  update ingreso_pedidos_tienda set total = total + v_subtotal where id = p_pedido;
end
$$;
