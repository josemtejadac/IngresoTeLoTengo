import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { formatCLP } from './payroll'
import { loadVentasPedidos } from './tienda'

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

  // Dinero de deudas cobradas (abonos): cuenta en el dia en que se cobra, no cuando se fio.
  const { data: abonosData, error: abonosError } = await supabase
    .from('ingreso_abonos')
    .select('monto, created_at')
    .gte('created_at', new Date(start.getFullYear(), start.getMonth(), start.getDate()).toISOString())
    .lt('created_at', new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).toISOString())
  if (abonosError) throw abonosError
  const cobrosPorFecha = new Map<string, number>()
  for (const a of (abonosData as { monto: number; created_at: string }[]) ?? []) {
    const d = toISODate(new Date(a.created_at))
    cobrosPorFecha.set(d, (cobrosPorFecha.get(d) ?? 0) + Number(a.monto))
  }

  // Pedidos de la tienda entregados: online, efectivo y tarjeta (contra entrega).
  const onlinePorFecha = new Map<string, number>()
  const tiendaEfectivo = new Map<string, number>()
  const tiendaTarjeta = new Map<string, number>()
  for (const v of await loadVentasPedidos(toISODate(start), toISODate(end))) {
    const mapa = v.metodo === 'online' ? onlinePorFecha : v.metodo === 'efectivo' ? tiendaEfectivo : tiendaTarjeta
    mapa.set(v.fecha, (mapa.get(v.fecha) ?? 0) + v.monto)
  }
  const tiendaTotalDia = (d: string) =>
    (onlinePorFecha.get(d) ?? 0) + (tiendaEfectivo.get(d) ?? 0) + (tiendaTarjeta.get(d) ?? 0)

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

  const dates = [...new Set([...byDate.keys(), ...cobrosPorFecha.keys(), ...onlinePorFecha.keys(), ...tiendaEfectivo.keys(), ...tiendaTarjeta.keys()])].sort()
  const emptyDay = { efectivo: 0, debito: 0, credito: 0, transferencia: 0 }
  const grandTotal = dates.reduce((sum, d) => {
    const e = byDate.get(d) ?? emptyDay
    return sum + e.efectivo + e.debito + e.credito + e.transferencia + (cobrosPorFecha.get(d) ?? 0) + tiendaTotalDia(d)
  }, 0)

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text('Te Lo Tengo Market', 14, 18)
  doc.setFontSize(12)
  doc.text(title, 14, 26)

  autoTable(doc, {
    startY: 34,
    head: [['Fecha', 'Efectivo', 'Débito', 'Crédito', 'Transferencia', 'Deudas cobradas', 'Tienda online', 'Tienda efectivo', 'Tienda tarjeta', 'Venta']],
    body: dates.map((d) => {
      const e = byDate.get(d) ?? emptyDay
      const cobros = cobrosPorFecha.get(d) ?? 0
      const total = e.efectivo + e.debito + e.credito + e.transferencia + cobros + tiendaTotalDia(d)
      return [
        d,
        formatCLP(e.efectivo),
        formatCLP(e.debito),
        formatCLP(e.credito),
        formatCLP(e.transferencia),
        formatCLP(cobros),
        formatCLP(onlinePorFecha.get(d) ?? 0),
        formatCLP(tiendaEfectivo.get(d) ?? 0),
        formatCLP(tiendaTarjeta.get(d) ?? 0),
        formatCLP(total),
      ]
    }),
    foot: [['', '', '', '', '', '', '', '', 'Total', formatCLP(grandTotal)]],
    styles: { fontSize: 8 },
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
