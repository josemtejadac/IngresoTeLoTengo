import { supabase } from './supabase'
import type { Attendance, Profile } from '../types'
import { computeShifts } from './hours'
import { annotateOvertime, computePaySummary, type PaySummary } from './payroll'
import {
  WEEKLY_BONUS_AMOUNT,
  formatWeekLabel,
  getCurrentWeek,
  loadWeeklyBonusForWorker,
  loadWeeklyBonusRow,
  totalEarned,
  type WeekRange,
} from './weeklyBonus'
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

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

export interface WeekPaySummary {
  week: WeekRange
  label: string
  pay: PaySummary
  weeklyBonusEarned: boolean
  weeklyBonusTotal: number
  feriadoDays: FeriadoDay[]
  feriadoTotal: number
  /** Base + horas extra + bono martes + bono semanal + feriados de esa semana (lunes a domingo). */
  total: number
}

// El historial semanal solo muestra semanas desde que Ricardo empezo a cobrar semanal (antes no se llevaba
// asi). Se ajusta una sola vez si hace falta correr el inicio mas atras.
const WEEKLY_HISTORIAL_DESDE = '2026-09-14'

/** Semanas (lunes a domingo) anteriores a la semana en curso, de la mas reciente a la mas antigua (nunca antes de WEEKLY_HISTORIAL_DESDE). */
export function previousWeeks(cantidad: number): WeekRange[] {
  const current = getCurrentWeek()
  const weeks: WeekRange[] = []
  for (let i = 1; i <= cantidad; i++) {
    const end = new Date(current.start)
    end.setDate(end.getDate() - 1 - 7 * (i - 1))
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    if (toISODate(start) < WEEKLY_HISTORIAL_DESDE) break
    weeks.push({ start, end })
  }
  return weeks
}

/** Resumen de sueldo semanal (lunes a domingo) de un trabajador que cobra semanal, con el mismo calculo del PDF. */
export async function loadWeekPaySummary(worker: Profile, week: WeekRange): Promise<WeekPaySummary> {
  const start = new Date(week.start.getFullYear(), week.start.getMonth(), week.start.getDate(), 0, 0, 0)
  const end = new Date(week.end.getFullYear(), week.end.getMonth(), week.end.getDate() + 1, 0, 0, 0)

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

  const bonusRow = await loadWeeklyBonusRow(worker.id, week)
  const weeklyBonusEarned = bonusRow?.earned ?? false
  const weeklyBonusTotal = weeklyBonusEarned ? WEEKLY_BONUS_AMOUNT : 0

  const [feriados, exclusions] = await Promise.all([loadFeriados(), loadFeriadoExclusionsForWorker(worker.id)])
  const excludedDates = new Set(exclusions.map((e) => e.fecha))
  const feriadoSummary = computeFeriadoBonus(shifts, feriados, excludedDates)

  const total = pay.baseAmount + pay.overtimePay + pay.tuesdayBonusTotal + weeklyBonusTotal + feriadoSummary.total

  return {
    week,
    label: formatWeekLabel(week),
    pay,
    weeklyBonusEarned,
    weeklyBonusTotal,
    feriadoDays: feriadoSummary.days,
    feriadoTotal: feriadoSummary.total,
    total,
  }
}

/** Trae el resumen de varias semanas ya cerradas a la vez (para el historial de pagos de sueldo semanal). */
export async function loadWeekPayHistory(worker: Profile, weeks: WeekRange[]): Promise<WeekPaySummary[]> {
  return Promise.all(weeks.map((w) => loadWeekPaySummary(worker, w)))
}

export { currentMonthValue }
