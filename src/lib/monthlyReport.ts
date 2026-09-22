import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import type { Attendance } from '../types'
import { computeShifts, formatHoursMinutes, formatTime } from './hours'

const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

/**
 * `month` en formato "YYYY-MM" (el mismo que entrega <input type="month">).
 */
export async function downloadMonthlyHoursPdf(
  workerId: string,
  workerName: string,
  month: string,
) {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1

  const start = new Date(year, monthIndex, 1, 0, 0, 0)
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0)
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()

  const { data, error } = await supabase
    .from('ingreso_attendance')
    .select('*')
    .eq('worker_id', workerId)
    .gte('recorded_at', start.toISOString())
    .lt('recorded_at', end.toISOString())
    .order('recorded_at', { ascending: true })

  if (error) throw error

  const shifts = computeShifts((data as Attendance[]) ?? [])
  const totalMs = shifts.reduce((sum, s) => sum + s.workedMs, 0)

  const doc = new jsPDF()
  const monthLabel = `${MONTH_NAMES[monthIndex]} ${year}`

  doc.setFontSize(16)
  doc.text('Te Lo Tengo Market', 14, 18)
  doc.setFontSize(12)
  doc.text(`Reporte de horas trabajadas`, 14, 26)
  doc.setFontSize(10)
  doc.text(`Trabajador: ${workerName}`, 14, 34)
  doc.text(`Periodo: 1 al ${lastDay} de ${monthLabel}`, 14, 40)

  autoTable(doc, {
    startY: 48,
    head: [['Fecha', 'Entrada', 'Salida', 'Colación', 'Horas trabajadas']],
    body: shifts.map((s) => [
      s.date,
      formatTime(s.entrada),
      s.inProgress ? 'En curso' : formatTime(s.salida),
      s.breakMs > 0 ? formatHoursMinutes(s.breakMs) : '—',
      s.inProgress ? `${formatHoursMinutes(s.workedMs)} (en curso)` : formatHoursMinutes(s.workedMs),
    ]),
    foot: [['', '', '', 'Total', formatHoursMinutes(totalMs)]],
    headStyles: { fillColor: [20, 83, 45] },
    footStyles: { fillColor: [230, 240, 230], textColor: [20, 83, 45], fontStyle: 'bold' },
  })

  if (shifts.some((s) => s.inProgress)) {
    const finalY =
      (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 48
    doc.setFontSize(8)
    doc.text(
      'El turno "en curso" aun no tiene salida registrada; sus horas son un calculo hasta el momento de generar este PDF.',
      14,
      finalY + 8,
    )
  }

  const safeName = workerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  doc.save(`horas-${safeName}-${month}.pdf`)
}
