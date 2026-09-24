import { createClient } from "jsr:@supabase/supabase-js@2";

// Borra los reportes de limpieza (y sus fotos) con mas de 10 dias. Se ejecuta a diario con pg_cron.
Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const limite = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  const { data: viejos, error } = await admin
    .from("ingreso_reportes_limpieza")
    .select("id, foto_path")
    .lt("created_at", limite);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!viejos || viejos.length === 0) return new Response(JSON.stringify({ borrados: 0 }));

  const { error: rmError } = await admin.storage
    .from("ingreso-limpieza")
    .remove(viejos.map((r: { foto_path: string }) => r.foto_path));
  if (rmError) return new Response(JSON.stringify({ error: rmError.message }), { status: 500 });

  const { error: delError } = await admin
    .from("ingreso_reportes_limpieza")
    .delete()
    .in("id", viejos.map((r: { id: string }) => r.id));
  if (delError) return new Response(JSON.stringify({ error: delError.message }), { status: 500 });

  return new Response(JSON.stringify({ borrados: viejos.length }));
});
