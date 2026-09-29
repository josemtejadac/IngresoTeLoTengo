import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from './supabase'
import { formatCLP } from './payroll'
import { formatGramos } from './peso'

interface Fila {
  nombre_producto: string
  cantidad: number
  es_peso: boolean
  subtotal: number
}

/**
 * PDF con los productos efectivamente vendidos en un dia (pedidos de la tienda, sin contar los cancelados),
 * agrupados por producto: cantidad, precio y total. `date` en formato AAAA-MM-DD.
 */
export async function downloadProductosVendidosPdf(date: string) {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  const { data: pedidos, error: pedidosError } = await supabase
    .from('ingreso_pedidos_tienda')
    .select('id')
    .gte('created_at', start.toISOString())
    .lt('created_at', end.toISOString())
    .neq('estado', 'cancelado')
    .neq('pago_estado', 'esperando_pago')
  if (pedidosError) throw pedidosError

  const ids = ((pedidos as { id: string }[]) ?? []).map((p) => p.id)
  if (ids.length === 0) {
    throw new Error('No hubo productos vendidos ese día.')
  }

  const { data: items, error: itemsError } = await supabase
    .from('ingreso_pedidos_tienda_items')
    .select('nombre_producto, cantidad, es_peso, subtotal')
    .in('pedido_id', ids)
  if (itemsError) throw itemsError

  const filas = (items as Fila[]) ?? []
  if (filas.length === 0) {
    throw new Error('No hubo productos vendidos ese día.')
  }

  // Se agrupa por nombre de producto (y si es por peso, para no mezclar unidades con gramos).
  const agrupado = new Map<string, { nombre: string; cantidad: number; esPeso: boolean; total: number }>()
  for (const f of filas) {
    const clave = `${f.nombre_producto}|${f.es_peso}`
    const entry = agrupado.get(clave) ?? { nombre: f.nombre_producto, cantidad: 0, esPeso: f.es_peso, total: 0 }
    entry.cantidad += f.cantidad
    entry.total += f.subtotal
    agrupado.set(clave, entry)
  }
  const filasOrdenadas = [...agrupado.values()].sort((a, b) => b.total - a.total)
  const totalGeneral = filasOrdenadas.reduce((sum, f) => sum + f.total, 0)

  const doc = new jsPDF()
  doc.setFontSize(16)
  doc.text('Te Lo Tengo Market', 14, 18)
  doc.setFontSize(12)
  doc.text('Productos vendidos del día', 14, 26)
  doc.setFontSize(10)
  doc.text(`Fecha: ${date}`, 14, 33)

  autoTable(doc, {
    startY: 40,
    head: [['Producto', 'Cantidad vendida', 'Precio promedio', 'Total']],
    body: filasOrdenadas.map((f) => {
      const cantidadTexto = f.esPeso ? formatGramos(f.cantidad) : `${f.cantidad} un`
      const precioProm = f.cantidad > 0 ? f.total / (f.esPeso ? f.cantidad / 1000 : f.cantidad) : 0
      return [f.nombre, cantidadTexto, `${formatCLP(Math.round(precioProm))}${f.esPeso ? '/kg' : ''}`, formatCLP(f.total)]
    }),
    foot: [['', '', 'Total', formatCLP(totalGeneral)]],
    headStyles: { fillColor: [20, 83, 45] },
    footStyles: { fillColor: [230, 240, 230], textColor: [20, 83, 45], fontStyle: 'bold' },
  })

  doc.save(`productos-vendidos-${date}.pdf`)
}
