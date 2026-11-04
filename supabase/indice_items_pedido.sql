-- La tabla de productos de cada pedido no tenia indice por pedido: cada consulta leia la tabla completa.
-- Ya ejecutado en el SQL Editor de Supabase el 04-11-2026 (no borra ni cambia datos).

create index if not exists ingreso_pedidos_tienda_items_pedido_id_idx
  on public.ingreso_pedidos_tienda_items (pedido_id);
