-- YA PROGRAMADO (28-10-2026) en pg_cron, no hace falta correrlo de nuevo. Queda aqui como registro.
-- El 05-11-2026 a las 00:00 hora de Chile (03:00 UTC) los productos de la categoria HALLOWEEN vuelven a
-- SNACKS CONFITES (de donde vinieron) sin subcategoria, y la tarea se borra sola despues de correr una vez.
-- El tema visual de Halloween de la tienda se apaga solo esa misma noche (src/lib/temaTienda.ts).
select cron.schedule(
  'ingreso_fin_halloween_2026',
  '0 3 5 11 *',
  $job$
    update public.ingreso_productos set categoria = 'SNACKS   CONFITES', subcategoria = null where categoria = 'HALLOWEEN';
    select cron.unschedule('ingreso_fin_halloween_2026');
  $job$
);
