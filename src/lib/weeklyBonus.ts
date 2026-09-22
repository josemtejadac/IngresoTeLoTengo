import { supabase } from './supabase'

export const WEEKLY_BONUS_AMOUNT = 25000
export const WEEKS_PER_MONTH = [1, 2, 3, 4] as const

export interface WeeklyBonusRow {
  worker_id: string
  month: string
  week_number: number
  earned: boolean
  amount: number
}

/** `month` en formato "YYYY-MM". */
export async function loadWeeklyBonusForMonth(month: string): Promise<WeeklyBonusRow[]> {
  const { data, error } = await supabase
    .from('ingreso_weekly_bonus')
    .select('*')
    .eq('month', month)
  if (error) throw error
  return (data as WeeklyBonusRow[]) ?? []
}

export async function loadWeeklyBonusForWorker(
  workerId: string,
  month: string,
): Promise<WeeklyBonusRow[]> {
  const { data, error } = await supabase
    .from('ingreso_weekly_bonus')
    .select('*')
    .eq('worker_id', workerId)
    .eq('month', month)
  if (error) throw error
  return (data as WeeklyBonusRow[]) ?? []
}

export async function setWeeklyBonusEarned(
  workerId: string,
  month: string,
  weekNumber: number,
  earned: boolean,
) {
  const { error } = await supabase.from('ingreso_weekly_bonus').upsert(
    {
      worker_id: workerId,
      month,
      week_number: weekNumber,
      earned,
      amount: WEEKLY_BONUS_AMOUNT,
    },
    { onConflict: 'worker_id,month,week_number' },
  )
  if (error) throw error
}

export function totalEarned(rows: WeeklyBonusRow[]): number {
  return rows.filter((r) => r.earned).reduce((sum, r) => sum + r.amount, 0)
}
