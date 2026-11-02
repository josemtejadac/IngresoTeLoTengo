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

/** Desde las semanas que empiezan en esta fecha rige la regla de "los dias 1 y 2" (ver getWeeksEndingInMonth). */
const REGLA_DIA_2_DESDE = '2026-10-26'

/**
 * Las semanas de pago van de lunes a domingo (el corte/cierre es el domingo). Una semana que cruza de un mes a otro
 * cuenta para el mes donde caen la mayoria de sus dias laborales:
 *  - si termina el dia 1 o 2 del mes siguiente, sigue contando en el mes que se cierra (ej. 26/10-01/11 es de octubre);
 *  - si termina el dia 3 o despues, cuenta en el mes que entra (ej. 30/11-06/12 es de diciembre).
 * Antes del 26/10/2026 se mantiene la regla anterior (el mes de su domingo) para no cambiar lo ya pagado.
 * Segun el mes salen 4 o 5 semanas.
 */
function mesDeLaSemana(start: Date, end: Date): { year: number; month: number } {
  const usaFin = toISODate(start) < REGLA_DIA_2_DESDE || end.getDate() > 2
  const ref = usaFin ? end : start
  return { year: ref.getFullYear(), month: ref.getMonth() }
}

export function getWeeksEndingInMonth(month: string): WeekRange[] {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1

  // Se recorren los lunes cercanos al mes y se queda con las semanas que le pertenecen.
  const weeks: WeekRange[] = []
  const cursor = new Date(year, monthIndex, 1 - 7)
  cursor.setDate(cursor.getDate() + ((8 - cursor.getDay()) % 7)) // primer lunes
  const limite = new Date(year, monthIndex + 1, 7)
  while (cursor <= limite) {
    const start = new Date(cursor)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const dueno = mesDeLaSemana(start, end)
    if (dueno.year === year && dueno.month === monthIndex) weeks.push({ start, end })
    cursor.setDate(cursor.getDate() + 7)
  }
  return weeks
}

/** La semana (lunes a domingo) a la que pertenece una fecha dada. */
export function getWeekForDate(date: Date): WeekRange {
  const dia = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay(): 0=domingo..6=sabado. Queremos el lunes de esa semana.
  const diffToMonday = (dia.getDay() + 6) % 7
  const start = new Date(dia)
  start.setDate(start.getDate() - diffToMonday)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return { start, end }
}

/** La semana (lunes a domingo) a la que pertenece "hoy". */
export function getCurrentWeek(): WeekRange {
  return getWeekForDate(new Date())
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

/** Fila de bono semanal de una semana puntual (para el sueldo semanal en tiempo real). */
export async function loadWeeklyBonusRow(workerId: string, week: WeekRange): Promise<WeeklyBonusRow | null> {
  const { data, error } = await supabase
    .from('ingreso_weekly_bonus')
    .select('*')
    .eq('worker_id', workerId)
    .eq('week_end', toISODate(week.end))
    .maybeSingle()
  if (error) throw error
  return (data as WeeklyBonusRow) ?? null
}

export function isWeekEarned(rows: WeeklyBonusRow[], week: WeekRange): boolean {
  const weekEndIso = toISODate(week.end)
  return rows.some((r) => r.week_end === weekEndIso && r.earned)
}

export function totalEarned(rows: WeeklyBonusRow[]): number {
  return rows.filter((r) => r.earned).reduce((sum, r) => sum + r.amount, 0)
}
