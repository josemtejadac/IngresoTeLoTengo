import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatCLP } from './payroll'
import { ventaTotal, type ArqueoRowWithWorker } from './arqueo'

/**
 * Descarga en PDF el arqueo de un dia: de todos los trabajadores, o de uno solo si se pasa workerId.
 * Suma todas las filas (manual/pedido/abono) por trabajador, para que quede un total limpio por persona.
 */
export function downloadArqueoPdf(rows: ArqueoRowWithWorker[], date: string, workerId?: string) {
  const filas = workerId ? rows.filter((r) => r.worker_id === workerId) : rows
  if (filas.length === 0) {
    throw new Error('No hay arqueo registrado para esta selección.')
  }

  const porTrabajador = new Map<
    string,
    { nombre: string; efectivo: number; debito: number; credito: number; transferencia: number; qr: number }
  >()
  for (const r of filas) {
    const nombre = r.ingreso_profiles?.full_name ?? 'Desconocido'
    const entry = porTrabajador.get(r.worker_id) ?? {
      nombre,
      efectivo: 0,
      debito: 0,
      credito: 0,
      transferencia: 0,
      qr: 0,
    }
    entry.efectivo += Number(r.efectivo)
    entry.debito += Number(r.debito)
    entry.credito += Number(r.credito)
    entry.transferencia += Number(r.transferencia)
    entry.qr += Number(r.qr)
    porTrabajador.set(r.worker_id, entry)
  }

  const filasOrdenadas = [...porTrabajador.values()].sort((a, b) => a.nombre.localeCompare(b.nombre))
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
