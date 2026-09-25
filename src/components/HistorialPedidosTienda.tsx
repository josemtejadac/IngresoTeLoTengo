import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import { FiltroPagoBotones } from './FiltroPagoBotones'
import {
  coincideFiltroPago,
  type FiltroPago,
  loadPedidosTiendaDelDia,
  loadPedidoTiendaItems,
  METODO_PAGO_LABEL,
  type PedidoTienda,
  type PedidoTiendaItem,
} from '../lib/tienda'

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function textoItem(it: PedidoTiendaItem): string {
  if (!it.es_peso) return `${it.cantidad}x ${it.nombre_producto}`
  const un = it.unidades ? `${it.unidades} un, ` : ''
  return `${it.nombre_producto} (${un}${it.aprox ? '≈ ' : ''}${formatGramos(it.cantidad)})`
}

export function HistorialPedidosTienda() {
  const [fecha, setFecha] = useState(hoyISO)
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([])
  const [items, setItems] = useState<Record<string, PedidoTiendaItem[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroPago>('todos')

  const load = useCallback(async () => {
    try {
      const rows = await loadPedidosTiendaDelDia(fecha)
      setPedidos(rows)
      const entries = await Promise.all(
        rows.map(async (p) => [p.id, await loadPedidoTiendaItems(p.id)] as const),
      )
      setItems(Object.fromEntries(entries))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando el historial')
    }
  }, [fecha])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_pedidos_tienda_historial')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_pedidos_tienda' }, () => {
        load()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  const filtrados = pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, filtro))
  const cuentas: Record<FiltroPago, number> = {
    todos: pedidos.length,
    online: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'online')).length,
    contraentrega: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'contraentrega')).length,
  }
  const total = filtrados.filter((p) => p.estado !== 'cancelado').reduce((sum, p) => sum + p.total, 0)

  return (
    <section className="card">
      <div className="section-header">
        <h2>Historial de pedidos de la tienda</h2>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <FiltroPagoBotones value={filtro} onChange={setFiltro} cuentas={cuentas} />
      {error && <p className="error-text">{error}</p>}
      <p className="subtitle">
        {filtrados.length} pedido(s) · Total: <strong>{formatCLP(total)}</strong>
      </p>
      {filtrados.length === 0 && <p className="subtitle">No hubo pedidos con este filtro.</p>}
      {filtrados.map((p) => (
        <div
          key={p.id}
          className={
            p.estado === 'cancelado'
              ? 'pedido-tienda-item pedido-cancelado'
              : p.pago_estado === 'pagado'
                ? 'pedido-tienda-item pedido-pagado'
                : 'pedido-tienda-item'
          }
        >
          {p.estado === 'cancelado' && (
            <p className="pedido-cancelado-etiqueta">
              ❌ {p.cancelado_por_cliente ? 'PEDIDO CANCELADO POR EL CLIENTE' : 'PEDIDO CANCELADO'}
              {p.cancelado_at &&
                ` · ${new Date(p.cancelado_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          )}
          <p>
            <strong>{p.nombre_cliente}</strong> — Torre {p.torre}, Depto {p.depto} ·{' '}
            {new Date(p.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="subtitle">{(items[p.id] ?? []).map(textoItem).join(', ')}</p>
          {p.estado === 'cancelado' ? (
            // Un pedido cancelado no se cobra: no se muestra "pago pendiente".
            <p className="pedido-cancelado-monto">
              {formatCLP(p.total)} · {p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago] : 'Sin dato'} · no se cobra
            </p>
          ) : (
            <p>
              {formatCLP(p.total)} · {p.estado === 'entregado' ? 'Entregado' : 'Por entregar'} ·{' '}
              {p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago] : 'Sin dato'}
              {p.pago_estado === 'pagado' ? (
                <>
                  {' · '}
                  <span className="badge-pagado">PAGADO</span>
                </>
              ) : (
                ' · Pago pendiente'
              )}
            </p>
          )}
        </div>
      ))}
    </section>
  )
}
