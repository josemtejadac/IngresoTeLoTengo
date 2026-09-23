import { supabase } from './supabase'

/**
 * Mapa id -> nombre de todos los usuarios activos, usando la misma RPC
 * publica del login (no expone nada sensible, solo nombre y rut). Sirve
 * para mostrar nombres de otros trabajadores en pantallas compartidas
 * (ej. quien registro o quien cobro un pendiente) sin depender de las
 * reglas de privacidad de ingreso_profiles.
 */
export async function loadNameDirectory(): Promise<Record<string, string>> {
  const { data, error } = await supabase.rpc('ingreso_login_directory')
  if (error) throw error
  const map: Record<string, string> = {}
  for (const row of (data as { id: string; full_name: string }[]) ?? []) {
    map[row.id] = row.full_name
  }
  return map
}
