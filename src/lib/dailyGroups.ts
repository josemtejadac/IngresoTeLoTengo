import type { Attendance } from '../types'

export interface DailyGroup {
  key: string
  workerId: string
  workerName: string
  dateLabel: string
  sortKey: number
  entrada: Attendance | null
  ingresoColacion: Attendance | null
  salidaColacion: Attendance | null
  salida: Attendance | null
}

interface RecordWithWorker extends Attendance {
  ingreso_profiles: { full_name: string } | null
}

/**
 * Agrupa los eventos sueltos (entrada, ingreso_colacion, salida_colacion, salida)
 * en una fila por trabajador + dia, para que el admin no tenga que leer una
 * lista larga de movimientos individuales.
 */
export function groupByWorkerAndDay(records: RecordWithWorker[]): DailyGroup[] {
  const groups = new Map<string, DailyGroup>()

  const sorted = [...records].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  )

  for (const r of sorted) {
    const at = new Date(r.recorded_at)
    const dateLabel = at.toLocaleDateString('es-CL')
    const key = `${r.worker_id}_${dateLabel}`

    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        workerId: r.worker_id,
        workerName: r.ingreso_profiles?.full_name ?? '—',
        dateLabel,
        sortKey: at.getTime(),
        entrada: null,
        ingresoColacion: null,
        salidaColacion: null,
        salida: null,
      }
      groups.set(key, group)
    }

    if (r.type === 'entrada' && !group.entrada) group.entrada = r
    else if (r.type === 'ingreso_colacion' && !group.ingresoColacion) group.ingresoColacion = r
    else if (r.type === 'salida_colacion' && !group.salidaColacion) group.salidaColacion = r
    else if (r.type === 'salida') group.salida = r
  }

  return [...groups.values()].sort((a, b) => b.sortKey - a.sortKey)
}
