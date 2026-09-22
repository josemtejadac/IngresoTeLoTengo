import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { formatCLP } from './payroll'

interface ArqueoRowRaw {
  arqueo_date: string
  efectivo: number
  debito: number
  credito: number
  transferencia: number
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface DownloadSalesPdfParams {
  start: Date
  end: Date
  title: string
  fileSuffix: string
  goal?: number
}

export async function downloadSalesPdf({
  start,
  end,
  title,
  fileSuffix,
  goal,
}: DownloadSalesPdfParams) {
  const { data, error } = await supabase
    .from('ingreso_arqueo')
    .select('arqueo_date, efectivo, debito, credito, transferencia')
    .gte('arqueo_date', toISODate(start))
    .lte('arqueo_date', toISODate(end))
    .order('arqueo_date', { ascending: true })

  if (error) throw error

  const rows = (data as ArqueoRowRaw[]) ?? []

  const byDate = new Map<
    string,
    { efectivo: number; debito: number; credito: number; transferencia: number }
  >()
  for (const r of rows) {
    const entry = byDate.get(r.arqueo_date) ?? {
      efectivo: 0,
      debito: 0,
      credito: 0,
      transferencia: 0,
    }
    entry.efectivo += Number(r.efectivo)
    entry.debito += Number(r.debito)
    entry.credito += Number(r.credito)
    entry.transferencia += Number(r.transferencia)
    byDate.set(r.arqueo_date, entry)
  }

  const dates = [...byDate.keys()].sort()
  const grandTotal = dates.reduce((sum, d) => {
    const e = byDate.get(d)!
    return sum + e.efectivo + e.debito + e.credito + e.transferencia
  }, 0)

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text('Te Lo Tengo Market', 14, 18)
  doc.setFontSize(12)
  doc.text(title, 14, 26)

  autoTable(doc, {
    startY: 34,
    head: [['Fecha', 'Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Venta bruta']],
    body: dates.map((d) => {
      const e = byDate.get(d)!
      const total = e.efectivo + e.debito + e.credito + e.transferencia
      return [
        d,
        formatCLP(e.efectivo),
        formatCLP(e.debito),
        formatCLP(e.credito),
        formatCLP(e.transferencia),
        formatCLP(total),
      ]
    }),
    foot: [['', '', '', '', 'Total', formatCLP(grandTotal)]],
    headStyles: { fillColor: [20, 83, 45] },
    footStyles: { fillColor: [230, 240, 230], textColor: [20, 83, 45], fontStyle: 'bold' },
  })

  if (goal) {
    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
    const pct = Math.min(100, Math.round((grandTotal / goal) * 100))
    doc.setFontSize(10)
    doc.text(`Meta: ${formatCLP(goal)} — Cumplido: ${pct}%`, 14, finalY + 10)
  }

  doc.save(`ventas-${fileSuffix}.pdf`)
}
