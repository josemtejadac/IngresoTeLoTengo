import { supabase } from './supabase'
import type { WeekRange } from './weeklyBonus'

/** Meta de venta semanal (lunes a domingo) para ganar el bono. */
export const WEEKLY_SALES_GOAL = 3000000

export interface ArqueoEntry {
  id: string
  worker_id: string
  arqueo_date: string
  created_at: string
  efectivo: number
  debito: number
  credito: number
  transferencia: number
  qr: number
  /** Fecha de la ultima correccion (null si nunca se edito). */
  editado_at?: string | null
  /** 'pedido'/'abono' quedan de filas viejas; ahora casi todo llega con origen 'manual' (lo exige la regla de edicion). */
  origen?: 'manual' | 'pedido' | 'abono'
  pedido_id?: string | null
  /** true solo si alguien realmente escribio/confirmo estos montos (formulario manual o Editar); false = la sumo sola la app. */
  tiene_ingreso_manual?: boolean
}

export interface ArqueoRowWithWorker extends ArqueoEntry {
  ingreso_profiles: { full_name: string } | null
}

export interface ArqueoInput {
  efectivo: number
  debito: number
  credito: number
  transferencia: number
  qr: number
}

export function ventaTotal(a: ArqueoInput): number {
  return a.efectivo + a.debito + a.credito + a.transferencia + a.qr
}

/**
 * Si un trabajador (o dia) tiene varias filas (ej. la de la app y una corregida despues), la que vale para
 * el total es la MAS RECIENTE: una correccion reemplaza a la fila vieja para el total, no se suman ambas.
 * Las demas quedan solo como historial para comparar.
 */
export function filasVigentesPorTrabajador<T extends Pick<ArqueoEntry, 'worker_id' | 'created_at'>>(rows: T[]): T[] {
  const porTrabajador = new Map<string, T>()
  for (const r of rows) {
    const actual = porTrabajador.get(r.worker_id)
    if (!actual || new Date(r.created_at) > new Date(actual.created_at)) {
      porTrabajador.set(r.worker_id, r)
    }
  }
  return [...porTrabajador.values()]
}

/** Como mostrar el origen de una fila de arqueo: "Arqueo editado" solo si se corrigio con Corregir; el resto es de la app. */
export function textoOrigenArqueo(a: Pick<ArqueoEntry, 'editado_at'>): string {
  return a.editado_at ? 'Arqueo editado' : 'Arqueo app'
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Solo se usa si el arqueo manual esta habilitado. Suma lo declarado a la fila del dia (si ya existia una, ej. creada sola por un pedido). */
export async function submitArqueo(workerId: string, _date: string, values: ArqueoInput) {
  const { error } = await supabase.rpc('ingreso_submit_arqueo_manual', {
    p_worker: workerId,
    p_efectivo: values.efectivo,
    p_debito: values.debito,
    p_credito: values.credito,
    p_transferencia: values.transferencia,
    p_qr: values.qr,
  })
  if (error) throw error
}

/**
 * Corrige el TOTAL del dia (sumando todas las filas que ya haya, ej. la que crea sola la app): se guarda
 * como una fila nueva con solo la diferencia, para no perder el numero original y poder comparar ambos.
 * Un trabajador solo puede corregir su propio dia de hoy; el admin puede corregir cualquier trabajador y fecha.
 */
export async function corregirArqueoDia(workerId: string, date: string, valores: ArqueoInput) {
  const { error } = await supabase.rpc('ingreso_corregir_arqueo', {
    p_worker: workerId,
    p_date: date,
    p_efectivo: valores.efectivo,
    p_debito: valores.debito,
    p_credito: valores.credito,
    p_transferencia: valores.transferencia,
    p_qr: valores.qr,
  })
  if (error) throw error
}

/** El admin (ej. Xioyerlin) decide si el formulario de arqueo manual esta disponible; por defecto esta apagado. */
export async function loadArqueoManualHabilitado(): Promise<boolean> {
  const { data, error } = await supabase.rpc('ingreso_get_config', { p_clave: 'arqueo_manual_habilitado' })
  if (error) throw error
  return data === true
}

export async function setArqueoManualHabilitado(valor: boolean) {
  const { error } = await supabase.rpc('ingreso_set_config', { p_clave: 'arqueo_manual_habilitado', p_valor: valor })
  if (error) throw error
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
