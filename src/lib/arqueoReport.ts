import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCLP } from './payroll'
import { filasVigentesPorTrabajador, ventaTotal, type ArqueoRowWithWorker } from './arqueo'

/**
 * Descarga en PDF el arqueo de un dia: de todos los trabajadores, o de uno solo si se pasa workerId.
 * Si un trabajador quedo con mas de una fila (ej. se corrigio despues), solo cuenta la mas reciente.
 */
export function downloadArqueoPdf(rows: ArqueoRowWithWorker[], date: string, workerId?: string) {
  const filas = workerId ? rows.filter((r) => r.worker_id === workerId) : rows
  if (filas.length === 0) {
    throw new Error('No hay arqueo registrado para esta selección.')
  }

  const filasOrdenadas = filasVigentesPorTrabajador(filas)
    .map((r) => ({
      nombre: r.ingreso_profiles?.full_name ?? 'Desconocido',
      efectivo: Number(r.efectivo),
      debito: Number(r.debito),
      credito: Number(r.credito),
      transferencia: Number(r.transferencia),
      qr: Number(r.qr),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const grandTotal = filasOrdenadas.reduce((sum, f) => sum + ventaTotal(f), 0)

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text('Te Lo Tengo Market', 14, 18)
  doc.setFontSize(12)
  doc.text(workerId ? 'Arqueo del día — trabajador' : 'Arqueo del día — todos', 14, 26)
  doc.setFontSize(10)
  doc.text(`Fecha: ${date}`, 14, 33)

  autoTable(doc, {
    startY: 40,
    head: [['Trabajador', 'Efectivo', 'Débito', 'Crédito', 'Transferencia', 'QR', 'Venta total']],
    body: filasOrdenadas.map((f) => [
      f.nombre,
      formatCLP(f.efectivo),
      formatCLP(f.debito),
      formatCLP(f.credito),
      formatCLP(f.transferencia),
      formatCLP(f.qr),
      formatCLP(ventaTotal(f)),
    ]),
    foot: [['', '', '', '', '', 'Total', formatCLP(grandTotal)]],
    headStyles: { fillColor: [20, 83, 45] },
    footStyles: { fillColor: [230, 240, 230], textColor: [20, 83, 45], fontStyle: 'bold' },
  })

  const sufijo = workerId ? filasOrdenadas[0]?.nombre.replace(/\s+/g, '-').toLowerCase() : 'todos'
  doc.save(`arqueo-${date}-${sufijo}.pdf`)
}
