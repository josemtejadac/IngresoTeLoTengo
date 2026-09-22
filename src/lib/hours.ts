import type { Attendance } from '../types'

export interface ShiftSummary {
  date: string
  entrada: Date
  salida: Date
  breakMs: number
  workedMs: number
}

/**
 * Empareja entrada/salida en turnos, restando el tiempo de colación
 * (ingreso_colacion -> salida_colacion) que haya ocurrido dentro de cada turno.
 */
export function computeShifts(records: Attendance[]): ShiftSummary[] {
  const sorted = [...records].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  )

  const shifts: ShiftSummary[] = []
  let entradaAt: Date | null = null
  let colacionStart: Date | null = null
  let breakMs = 0

  for (const r of sorted) {
    const at = new Date(r.recorded_at)
    if (r.type === 'entrada') {
      entradaAt = at
      breakMs = 0
      colacionStart = null
    } else if (r.type === 'ingreso_colacion') {
      colacionStart = at
    } else if (r.type === 'salida_colacion') {
      if (colacionStart) {
        breakMs += at.getTime() - colacionStart.getTime()
        colacionStart = null
      }
    } else if (r.type === 'salida') {
      if (entradaAt) {
        const workedMs = Math.max(0, at.getTime() - entradaAt.getTime() - breakMs)
        shifts.push({
          date: entradaAt.toLocaleDateString('es-CL'),
          entrada: entradaAt,
          salida: at,
          breakMs,
          workedMs,
        })
        entradaAt = null
        breakMs = 0
      }
    }
  }

  return shifts
}

export function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}
