import { supabase } from './supabase'

export interface PendienteEntry {
  id: string
  worker_id: string
  monto: number
  comentario: string
  /** Nombre del cliente; los registros antiguos no lo tienen y usan comentario. */
  cliente: string | null
  pendiente_date: string
  /** Suma de abonos parciales ya recibidos. */
  abonado: number
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

/** Inserta varios pendientes de una vez (varios clientes que fiaron el mismo dia). */
export async function addPendientes(
  workerId: string,
  rows: { cliente: string; detalle: string; monto: number }[],
) {
  const { error } = await supabase.from('ingreso_pendientes').insert(
    rows.map((r) => ({
      worker_id: workerId,
      monto: r.monto,
      cliente: r.cliente,
      comentario: r.detalle,
    })),
  )
  if (error) throw error
}

export async function markPendientesPagados(ids: string[], paidByWorkerId: string) {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('ingreso_pendientes')
    .update({ pagado: true, paid_by: paidByWorkerId, paid_at: new Date().toISOString() })
    .in('id', ids)
    .eq('pagado', false)
  if (error) throw error
}

export function clienteNombre(p: PendienteEntry): string {
  return (p.cliente?.trim() || p.comentario).trim()
}

export interface DeudaCliente {
  key: string
  nombre: string
  total: number
  deudas: PendienteEntry[]
}

/** Agrupa las deudas sin cobrar por cliente (sin distinguir mayusculas ni espacios extra). */
export function agruparPorCliente(rows: PendienteEntry[]): DeudaCliente[] {
  const map = new Map<string, DeudaCliente>()
  for (const p of rows.filter((r) => !r.pagado)) {
    const nombre = clienteNombre(p)
    const key = nombre.toLowerCase().replace(/\s+/g, ' ')
    const g = map.get(key) ?? { key, nombre, total: 0, deudas: [] }
    g.total += saldo(p)
    g.deudas.push(p)
    map.set(key, g)
  }
  const list = [...map.values()]
  for (const g of list) {
    g.deudas.sort((a, b) => a.created_at.localeCompare(b.created_at))
  }
  return list.sort((a, b) => b.total - a.total)
}

export async function markPendientePagado(id: string, paidByWorkerId: string) {
  const { error } = await supabase
    .from('ingreso_pendientes')
    .update({ pagado: true, paid_by: paidByWorkerId, paid_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Lo que aun falta cobrar de una deuda (monto menos abonos). */
export function saldo(p: PendienteEntry): number {
  return Math.max(0, p.monto - p.abonado)
}

export function totalPendiente(rows: PendienteEntry[]): number {
  return rows.filter((r) => !r.pagado).reduce((sum, r) => sum + saldo(r), 0)
}

/** Abono parcial: se aplica primero a las deudas mas antiguas de la lista de ids. */
export async function abonarPendientes(ids: string[], monto: number) {
  const { error } = await supabase.rpc('ingreso_abonar', { p_ids: ids, p_monto: monto })
  if (error) throw error
}
