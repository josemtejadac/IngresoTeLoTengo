import { supabase } from './supabase'
import type { WeekRange } from './weeklyBonus'

/** Meta de venta semanal (lunes a domingo) para ganar el bono. */
export const WEEKLY_SALES_GOAL = 3000000

export interface ArqueoEntry {
  id: string
  worker_id: string
  arqueo_date: string
  efectivo: number
  debito: number
  credito: number
  transferencia: number
  /** Fecha de la ultima correccion (null si nunca se edito). */
  editado_at?: string | null
  /** 'pedido' = la sumo sola la app al entregar un pedido de la tienda; no se puede editar. */
  origen?: 'manual' | 'pedido'
  pedido_id?: string | null
}

export interface ArqueoRowWithWorker extends ArqueoEntry {
  ingreso_profiles: { full_name: string } | null
}

export interface ArqueoInput {
  efectivo: number
  debito: number
  credito: number
  transferencia: number
}

export function ventaTotal(a: ArqueoInput): number {
  return a.efectivo + a.debito + a.credito + a.transferencia
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function submitArqueo(workerId: string, date: string, values: ArqueoInput) {
  const { error } = await supabase.from('ingreso_arqueo').insert({
    worker_id: workerId,
    arqueo_date: date,
    ...values,
  })
  if (error) throw error
}

/** Corrige un arqueo propio. La base de datos solo lo permite el mismo dia. */
export async function updateArqueo(id: string, values: ArqueoInput) {
  const { data, error } = await supabase
    .from('ingreso_arqueo')
    .update(values)
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('Este arqueo ya no se puede editar: solo se corrige el mismo día.')
  }
}

export async function loadArqueoForWorkerDay(
  workerId: string,
  date: string,
): Promise<ArqueoEntry[]> {
  const { data, error } = await supabase
    .from('ingreso_arqueo')
    .select('*')
    .eq('worker_id', workerId)
    .eq('arqueo_date', date)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as ArqueoEntry[]) ?? []
}

export async function loadArqueoForDate(date: string): Promise<ArqueoRowWithWorker[]> {
  const { data, error } = await supabase
    .from('ingreso_arqueo')
    .select('*, ingreso_profiles(full_name)')
    .eq('arqueo_date', date)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as unknown as ArqueoRowWithWorker[]) ?? []
}

/** Disponible para cualquier usuario autenticado (no expone el detalle de caja de cada quien). */
export async function loadWeeklySalesTotal(week: WeekRange): Promise<number> {
  const { data, error } = await supabase.rpc('ingreso_weekly_sales_total', {
    p_week_start: toISODate(week.start),
    p_week_end: toISODate(week.end),
  })
  if (error) throw error
  return Number(data) || 0
}
