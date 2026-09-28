import { supabase } from './supabase'
import type { Attendance, Profile } from '../types'
import { computeShifts } from './hours'
import { annotateOvertime, computePaySummary, type PaySummary } from './payroll'
import { loadWeeklyBonusForWorker, totalEarned } from './weeklyBonus'
import { computeFeriadoBonus, loadFeriados, loadFeriadoExclusionsForWorker, type FeriadoDay } from './feriados'

const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export interface MonthPaySummary {
  month: string
  label: string
  pay: PaySummary
  weeklyBonusTotal: number
  feriadoDays: FeriadoDay[]
  feriadoTotal: number
  /** Solo tiene sentido para sueldo mensual: base + extras + bonos ganados ese mes. */
  total: number
}

function currentMonthValue(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// El historial solo muestra meses desde que se empezo a llevar bien (los de antes usaban otro sueldo/horario
// y no reflejan lo que realmente se pago). Se ajusta una sola vez si hace falta correr el inicio mas adelante.
const HISTORIAL_DESDE = '2026-09'

/** Meses anteriores al actual, del mas reciente al mas antiguo (nunca antes de HISTORIAL_DESDE). */
export function previousMonths(cantidad: number): string[] {
  const now = new Date()
  const meses: string[] = []
  for (let i = 1; i <= cantidad; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (mes < HISTORIAL_DESDE) break
    meses.push(mes)
  }
  return meses
}

/** Resumen de sueldo de un trabajador para un mes ya cerrado (o el actual), con el mismo calculo que el PDF. */
export async function loadMonthPaySummary(worker: Profile, month: string): Promise<MonthPaySummary> {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const start = new Date(year, monthIndex, 1, 0, 0, 0)
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0)

  const { data, error } = await supabase
    .from('ingreso_attendance')
    .select('*')
    .eq('worker_id', worker.id)
    .gte('recorded_at', start.toISOString())
    .lt('recorded_at', end.toISOString())
    .order('recorded_at', { ascending: true })
  if (error) throw error

  const shifts = annotateOvertime(computeShifts((data as Attendance[]) ?? []), worker)
  const pay = computePaySummary(shifts, worker, start, end)

  const weeklyBonusRows = await loadWeeklyBonusForWorker(worker.id, month)
  const weeklyBonusTotal = totalEarned(weeklyBonusRows)

  const [feriados, exclusions] = await Promise.all([loadFeriados(), loadFeriadoExclusionsForWorker(worker.id)])
  const excludedDates = new Set(exclusions.map((e) => e.fecha))
  const feriadoSummary = computeFeriadoBonus(shifts, feriados, excludedDates)

  const total =
    pay.payFrequency === 'monthly'
      ? pay.baseAmount + pay.overtimePay + pay.tuesdayBonusTotal + weeklyBonusTotal + feriadoSummary.total
      : pay.overtimePay + pay.tuesdayBonusTotal + weeklyBonusTotal + feriadoSummary.total

  return {
    month,
    label: `${MONTH_NAMES[monthIndex]} ${year}`,
    pay,
    weeklyBonusTotal,
    feriadoDays: feriadoSummary.days,
    feriadoTotal: feriadoSummary.total,
    total,
  }
}

/** Trae el resumen de varios meses a la vez (para el historial de pagos). */
export async function loadPayHistory(worker: Profile, meses: string[]): Promise<MonthPaySummary[]> {
  return Promise.all(meses.map((m) => loadMonthPaySummary(worker, m)))
}

export { currentMonthValue }
