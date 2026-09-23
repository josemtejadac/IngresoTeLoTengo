import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import {
  loadPedidosTiendaPendientes,
  loadPedidoTiendaItems,
  marcarPedidoTiendaEntregado,
  whatsappEstoyAbajoUrl,
  type PedidoTienda,
  type PedidoTiendaItem,
} from '../lib/tienda'

export function PedidosTienda() {
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([])
  const [items, setItems] = useState<Record<string, PedidoTiendaItem[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const rows = await loadPedidosTiendaPendientes()
      setPedidos(rows)
      const entries = await Promise.all(
        rows.map(async (p) => [p.id, await loadPedidoTiendaItems(p.id)] as const),
      )
      setItems(Object.fromEntries(entries))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando pedidos de la tienda')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_pedidos_tienda_staff')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ingreso_pedidos_tienda' },
        () => {
          load()
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  async function handleEntregado(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await marcarPedidoTiendaEntregado(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error marcando el pedido')
    } finally {
      setBusyId(null)
    }
  }

  if (pedidos.length === 0) return null

  return (
    <section className="card">
      <h2>Pedidos de la tienda ({pedidos.length})</h2>
      <p className="subtitle">Pedidos de vecinos esperando delivery.</p>
      {error && <p className="error-text">{error}</p>}
      {pedidos.map((p) => (
        <div key={p.id} className="pedido-tienda-item">
          <p>
            <strong>{p.nombre_cliente}</strong> — Torre {p.torre}, Depto {p.depto}
          </p>
          <p className="subtitle">
            {(items[p.id] ?? []).map((it) => `${it.cantidad}x ${it.nombre_producto}`).join(', ')}
          </p>
          <p>
            Total: <strong>{formatCLP(p.total)}</strong>
          </p>
          <div className="report-row">
            <a
              className="btn btn-primary"
              href={whatsappEstoyAbajoUrl(p.telefono_cliente)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Estoy abajo (WhatsApp)
            </a>
            <button
              className="btn btn-secondary"
              disabled={busyId === p.id}
              onClick={() => handleEntregado(p.id)}
            >
              {busyId === p.id ? 'Guardando...' : 'Marcar entregado'}
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}
