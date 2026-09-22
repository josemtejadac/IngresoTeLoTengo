import type { Attendance } from '../types'

export interface ShiftSummary {
  date: string
  entrada: Date
  salida: Date | null
  breakMs: number
  workedMs: number
  inProgress: boolean
}

/**
 * Empareja entrada/salida en turnos, restando el tiempo de colación
 * (ingreso_colacion -> salida_colacion) que haya ocurrido dentro de cada turno.
 * Si el ultimo turno no tiene salida registrada todavia, se incluye igual
 * como "en curso" con las horas trabajadas hasta el momento.
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
          inProgress: false,
        })
        entradaAt = null
        breakMs = 0
      }
    }
  }

  if (entradaAt) {
    const now = new Date()
    const openBreakMs = colacionStart ? breakMs : breakMs
    const workedMs = Math.max(0, now.getTime() - entradaAt.getTime() - openBreakMs)
    shifts.push({
      date: entradaAt.toLocaleDateString('es-CL'),
      entrada: entradaAt,
      salida: null,
      breakMs: openBreakMs,
      workedMs,
      inProgress: true,
    })
  }

  return shifts
}

export function formatHoursMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes.toString().padStart(2, '0')}m`
}

export function formatTime(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}
