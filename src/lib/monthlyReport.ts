import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import type { Attendance, Profile } from '../types'
import { computeShifts, formatHoursMinutes, formatTime } from './hours'
import { annotateOvertime, computePaySummary, formatCLP } from './payroll'

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

const FREQUENCY_LABELS: Record<'weekly' | 'monthly', string> = {
  weekly: 'semanal',
  monthly: 'mensual',
}

/**
 * `month` en formato "YYYY-MM" (el mismo que entrega <input type="month">).
 */
export async function downloadMonthlyHoursPdf(worker: Profile, month: string) {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIndex = Number(monthStr) - 1

  const start = new Date(year, monthIndex, 1, 0, 0, 0)
  const end = new Date(year, monthIndex + 1, 1, 0, 0, 0)
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()

  const { data, error } = await supabase
    .from('ingreso_attendance')
    .select('*')
    .eq('worker_id', worker.id)
    .gte('recorded_at', start.toISOString())
    .lt('recorded_at', end.toISOString())
    .order('recorded_at', { ascending: true })

  if (error) throw error

  const shifts = annotateOvertime(computeShifts((data as Attendance[]) ?? []), worker)
  const totalMs = shifts.reduce((sum, s) => sum + s.workedMs, 0)
  const pay = computePaySummary(shifts, worker, start, end)

  const doc = new jsPDF()
  const monthLabel = `${MONTH_NAMES[monthIndex]} ${year}`

  doc.setFontSize(16)
  doc.text('Te Lo Tengo Market', 14, 18)
  doc.setFontSize(12)
  doc.text(`Reporte de horas trabajadas`, 14, 26)
  doc.setFontSize(10)
  doc.text(`Trabajador: ${worker.full_name}`, 14, 34)
  doc.text(`Periodo: 1 al ${lastDay} de ${monthLabel}`, 14, 40)

  autoTable(doc, {
    startY: 48,
    head: [['Fecha', 'Entrada', 'Salida', 'Colación', 'Horas trabajadas', 'Horas extra']],
    body: shifts.map((s) => [
      s.date,
      formatTime(s.entrada),
      s.inProgress ? 'En curso' : formatTime(s.salida),
      s.breakMs > 0 ? formatHoursMinutes(s.breakMs) : '—',
      s.inProgress ? `${formatHoursMinutes(s.workedMs)} (en curso)` : formatHoursMinutes(s.workedMs),
      s.overtimeMs > 0 ? formatHoursMinutes(s.overtimeMs) : '—',
    ]),
    foot: [['', '', '', '', 'Total', formatHoursMinutes(totalMs)]],
    headStyles: { fillColor: [20, 83, 45] },
    footStyles: { fillColor: [230, 240, 230], textColor: [20, 83, 45], fontStyle: 'bold' },
  })

  let finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? 48

  if (shifts.some((s) => s.inProgress)) {
    doc.setFontSize(8)
    doc.text(
      'El turno "en curso" aun no tiene salida registrada; sus horas son un calculo hasta el momento de generar este PDF.',
      14,
      finalY + 6,
    )
    finalY += 6
  }

  autoTable(doc, {
    startY: finalY + 10,
    head: [['Resumen de pago del periodo']],
    body: [
      [
        `Sueldo base: ${formatCLP(pay.baseAmount)} ${
          pay.payFrequency ? `(${FREQUENCY_LABELS[pay.payFrequency]})` : ''
        }`,
      ],
      [`Horas extra del mes: ${formatHoursMinutes(pay.overtimeMs)} → ${formatCLP(pay.overtimePay)}`],
      ...(pay.tuesdayBonusCount > 0
        ? [
            [
              `Bono martes: ${pay.tuesdayBonusCount} martes × ${formatCLP(
                worker.tuesday_bonus,
              )} = ${formatCLP(pay.tuesdayBonusTotal)}`,
            ],
          ]
        : []),
    ],
    headStyles: { fillColor: [20, 83, 45] },
    styles: { fontSize: 9 },
  })

  const notesY =
    (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY ?? finalY + 10
  doc.setFontSize(8)
  doc.text(
    'El sueldo base se paga segun su frecuencia habitual; las horas extra y el bono de martes son montos adicionales generados durante este periodo.',
    14,
    notesY + 8,
  )

  const safeName = worker.full_name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  doc.save(`horas-${safeName}-${month}.pdf`)
}
