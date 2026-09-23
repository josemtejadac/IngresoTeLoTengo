import { supabase } from './supabase'

export interface PendienteEntry {
  id: string
  worker_id: string
  monto: number
  comentario: string
  pendiente_date: string
  pagado: boolean
  paid_by: string | null
  paid_at: string | null
  created_at: string
}

/**
 * No se hace embed a ingreso_profiles porque las reglas de privacidad
 * de esa tabla solo dejan ver el propio perfil (o al admin ver todos);
 * los nombres de otros trabajadores se resuelven aparte con
 * loadNameDirectory().
 */
export async function loadPendientes(): Promise<PendienteEntry[]> {
  const { data, error } = await supabase
    .from('ingreso_pendientes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as PendienteEntry[]) ?? []
}

export async function addPendiente(workerId: string, monto: number, comentario: string) {
  const { error } = await supabase.from('ingreso_pendientes').insert({
    worker_id: workerId,
    monto,
    comentario,
  })
  if (error) throw error
}

export async function markPendientePagado(id: string, paidByWorkerId: string) {
  const { error } = await supabase
    .from('ingreso_pendientes')
    .update({ pagado: true, paid_by: paidByWorkerId, paid_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export function totalPendiente(rows: PendienteEntry[]): number {
  return rows.filter((r) => !r.pagado).reduce((sum, r) => sum + r.monto, 0)
}
