import { supabase } from './supabase'
import type { ShiftSummary } from './hours'

export const FERIADO_BONUS = 15000
export const IRRENUNCIABLE_BONUS = 20000

export interface Feriado {
  id: string
  fecha: string
  nombre: string
  tipo: 'feriado' | 'irrenunciable'
}

export async function loadFeriados(): Promise<Feriado[]> {
  const { data, error } = await supabase
    .from('ingreso_feriados')
    .select('*')
    .order('fecha', { ascending: true })
  if (error) throw error
  return (data as Feriado[]) ?? []
}

export async function addFeriado(fecha: string, nombre: string, tipo: 'feriado' | 'irrenunciable') {
  const { error } = await supabase.from('ingreso_feriados').insert({ fecha, nombre, tipo })
  if (error) throw error
}

export async function deleteFeriado(id: string) {
  const { error } = await supabase.from('ingreso_feriados').delete().eq('id', id)
  if (error) throw error
}

export interface FeriadoExclusion {
  id: string
  worker_id: string
  fecha: string
}

/** Todas las exclusiones (solo el admin puede leer todas; un trabajador solo ve las suyas). */
export async function loadFeriadoExclusions(): Promise<FeriadoExclusion[]> {
  const { data, error } = await supabase.from('ingreso_feriado_exclusion').select('*')
  if (error) throw error
  return (data as FeriadoExclusion[]) ?? []
}

export async function loadFeriadoExclusionsForWorker(workerId: string): Promise<FeriadoExclusion[]> {
  const { data, error } = await supabase
    .from('ingreso_feriado_exclusion')
    .select('*')
    .eq('worker_id', workerId)
  if (error) throw error
  return (data as FeriadoExclusion[]) ?? []
}

export async function setFeriadoExclusion(workerId: string, fecha: string, excluded: boolean) {
  if (excluded) {
    const { error } = await supabase
      .from('ingreso_feriado_exclusion')
      .upsert({ worker_id: workerId, fecha }, { onConflict: 'worker_id,fecha' })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('ingreso_feriado_exclusion')
      .delete()
      .eq('worker_id', workerId)
      .eq('fecha', fecha)
    if (error) throw error
  }
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface FeriadoDay {
  fecha: string
  nombre: string
  tipo: 'feriado' | 'irrenunciable'
  monto: number
}

export interface FeriadoSummary {
  days: FeriadoDay[]
  total: number
}

/**
 * Por cada dia trabajado (turno con entrada) que coincida con un feriado
 * o irrenunciable, se suma el bono correspondiente una sola vez por dia
 * (aunque haya mas de un turno ese mismo dia). Las fechas que el admin
 * haya marcado como excluidas para ese trabajador (ej. no fue ese dia,
 * o estaba libre igual) no suman el bono aunque haya un turno registrado.
 */
export function computeFeriadoBonus(
  shifts: ShiftSummary[],
  feriados: Feriado[],
  excludedDates: Set<string> = new Set(),
): FeriadoSummary {
  const feriadoByDate = new Map(feriados.map((f) => [f.fecha, f]))
  const seen = new Set<string>()
  const days: FeriadoDay[] = []

  for (const s of shifts) {
    const fecha = toISODate(s.entrada)
    if (seen.has(fecha) || excludedDates.has(fecha)) continue
    const feriado = feriadoByDate.get(fecha)
    if (!feriado) continue
    seen.add(fecha)
    const monto = feriado.tipo === 'irrenunciable' ? IRRENUNCIABLE_BONUS : FERIADO_BONUS
    days.push({ fecha, nombre: feriado.nombre, tipo: feriado.tipo, monto })
  }

  return {
    days,
    total: days.reduce((sum, d) => sum + d.monto, 0),
  }
}
