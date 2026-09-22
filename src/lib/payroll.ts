import type { Profile } from '../types'
import type { ShiftSummary } from './hours'

/** Valor de la hora extra, igual para todos los trabajadores. */
export const OVERTIME_RATE_PER_HOUR = 2500

export interface ShiftWithOvertime extends ShiftSummary {
  overtimeMs: number
  isScheduledDay: boolean
}

function parseTimeToMinutes(value: string | undefined): number | null {
  if (!value) return null
  const [h, m] = value.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

/**
 * Marca cuanto tiempo de cada turno queda fuera del horario de ese dia de
 * la semana (entrar antes o salir despues de lo programado), para
 * calcularlo como hora extra. Cada dia puede tener un horario distinto
 * (ej. Darlin: mar-vie 08:30-17:30, sabado 09:00-17:30, domingo
 * 10:30-19:00). Si el dia no tiene horario configurado, no se calcula
 * hora extra (no hay con que comparar), pero las horas trabajadas igual
 * se cuentan.
 */
export function annotateOvertime(shifts: ShiftSummary[], profile: Profile): ShiftWithOvertime[] {
  return shifts.map((s) => {
    const weekday = s.entrada.getDay()
    const daySchedule = profile.weekly_schedule?.[String(weekday)]
    const startMinutes = parseTimeToMinutes(daySchedule?.start)
    const endMinutes = parseTimeToMinutes(daySchedule?.end)

    if (startMinutes === null || endMinutes === null) {
      return { ...s, overtimeMs: 0, isScheduledDay: false }
    }

    const schedStart = new Date(s.entrada)
    schedStart.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0)
    const schedEnd = new Date(s.entrada)
    schedEnd.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0)

    const earlyMs = Math.max(0, schedStart.getTime() - s.entrada.getTime())
    const lateMs = s.salida ? Math.max(0, s.salida.getTime() - schedEnd.getTime()) : 0

    return { ...s, overtimeMs: earlyMs + lateMs, isScheduledDay: true }
  })
}

export interface PaySummary {
  baseAmount: number
  payFrequency: 'weekly' | 'monthly' | null
  overtimeMs: number
  overtimePay: number
  tuesdayBonusCount: number
  tuesdayBonusTotal: number
}

/**
 * Resume las horas extra y el bono de martes generados dentro de un
 * periodo (no mezcla esto con el sueldo base: la frecuencia de pago del
 * sueldo base puede ser semanal o mensual y no calza 1 a 1 con "un mes",
 * asi que se muestran por separado para no dar un total incorrecto).
 */
export function computePaySummary(
  shifts: ShiftWithOvertime[],
  profile: Profile,
  periodStart: Date,
  periodEnd: Date,
): PaySummary {
  const overtimeMs = shifts.reduce((sum, s) => sum + s.overtimeMs, 0)
  const overtimeHours = overtimeMs / 3600000
  const overtimePay = Math.round(overtimeHours * OVERTIME_RATE_PER_HOUR)

  let tuesdayBonusCount = 0
  if (profile.tuesday_bonus > 0) {
    const cursor = new Date(periodStart)
    while (cursor < periodEnd) {
      if (cursor.getDay() === 2) tuesdayBonusCount++
      cursor.setDate(cursor.getDate() + 1)
    }
  }
  const tuesdayBonusTotal = tuesdayBonusCount * profile.tuesday_bonus

  return {
    baseAmount: profile.pay_amount ?? 0,
    payFrequency: profile.pay_frequency,
    overtimeMs,
    overtimePay,
    tuesdayBonusCount,
    tuesdayBonusTotal,
  }
}

export function formatCLP(amount: number): string {
  return amount.toLocaleString('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
}
