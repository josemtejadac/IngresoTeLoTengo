import { supabase } from './supabase'

export const WEEKLY_BONUS_AMOUNT = 25000

export interface WeekRange {
  start: Date
  end: Date
}

export interface WeeklyBonusRow {
  worker_id: string
  week_start: string
  week_end: string
  earned: boolean
  amount: number
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Las semanas de pago van de lunes a domingo (el corte/cierre es el
 * domingo). Una semana "pertenece" al mes en que cae su domingo de
 * cierre, aunque haya empezado un lunes del mes anterior — asi las
 * semanas que cruzan de un mes a otro quedan resueltas sin ambiguedad.
 * Segun el mes, puede haber 4 o 5 domingos (5 semanas), nunca siempre 4.
 */
export function getWeeksEndingInMonth(month: string): WeekRange[] {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

  const weeks: WeekRange[] = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, monthIndex, day)
    if (date.getDay() === 0) {
      const end = date
      const start = new Date(end)
      start.setDate(start.getDate() - 6)
      weeks.push({ start, end })
    }
  }
  return weeks
}

/** La semana (lunes a domingo) a la que pertenece "hoy". */
export function getCurrentWeek(): WeekRange {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  // getDay(): 0=domingo..6=sabado. Queremos el lunes de esta semana.
  const diffToMonday = (today.getDay() + 6) % 7
  const start = new Date(today)
  start.setDate(start.getDate() - diffToMonday)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start, end }
}

export function formatWeekLabel(week: WeekRange): string {
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
  return `${fmt(week.start)}–${fmt(week.end)}`
}

export async function loadWeeklyBonusForMonth(month: string): Promise<WeeklyBonusRow[]> {
  const weeks = getWeeksEndingInMonth(month)
  if (weeks.length === 0) return []
  const { data, error } = await supabase
    .from('ingreso_weekly_bonus')
    .select('*')
    .gte('week_end', toISODate(weeks[0].end))
    .lte('week_end', toISODate(weeks[weeks.length - 1].end))
  if (error) throw error
  return (data as WeeklyBonusRow[]) ?? []
}

export async function loadWeeklyBonusForWorker(
  workerId: string,
  month: string,
): Promise<WeeklyBonusRow[]> {
  const weeks = getWeeksEndingInMonth(month)
  if (weeks.length === 0) return []
  const { data, error } = await supabase
    .from('ingreso_weekly_bonus')
    .select('*')
    .eq('worker_id', workerId)
    .gte('week_end', toISODate(weeks[0].end))
    .lte('week_end', toISODate(weeks[weeks.length - 1].end))
  if (error) throw error
  return (data as WeeklyBonusRow[]) ?? []
}

export async function setWeeklyBonusEarned(workerId: string, week: WeekRange, earned: boolean) {
  const { error } = await supabase.from('ingreso_weekly_bonus').upsert(
    {
      worker_id: workerId,
      week_start: toISODate(week.start),
      week_end: toISODate(week.end),
      earned,
      amount: WEEKLY_BONUS_AMOUNT,
    },
    { onConflict: 'worker_id,week_end' },
  )
  if (error) throw error
}

export function isWeekEarned(rows: WeeklyBonusRow[], week: WeekRange): boolean {
  const weekEndIso = toISODate(week.end)
  return rows.some((r) => r.week_end === weekEndIso && r.earned)
}

export function totalEarned(rows: WeeklyBonusRow[]): number {
  return rows.filter((r) => r.earned).reduce((sum, r) => sum + r.amount, 0)
}
