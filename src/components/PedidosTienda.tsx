import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import {
  ajustarPesoItem,
  comprobanteUrl,
  marcarPedidoPagado,
  METODO_PAGO_LABEL,
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
  const [ajustando, setAjustando] = useState<string | null>(null)
  const [ajusteGramos, setAjusteGramos] = useState('')

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

  async function handleAjustar(itemId: string) {
    const gramos = Math.round(Number(ajusteGramos))
    if (!gramos || gramos < 10) return
    try {
      await ajustarPesoItem(itemId, gramos)
      setAjustando(null)
      setAjusteGramos('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error ajustando el peso')
    }
  }

  function textoItem(it: PedidoTiendaItem): string {
    if (!it.es_peso) return `${it.cantidad}x ${it.nombre_producto}`
    const pedido = it.unidades ? `${it.unidades} un, ` : ''
    return `${it.nombre_producto} (${pedido}${it.aprox ? '≈ ' : ''}${formatGramos(it.cantidad)})`
  }

  async function handlePagado(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await marcarPedidoPagado(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error marcando el pago')
    } finally {
      setBusyId(null)
    }
  }

  async function verComprobante(path: string) {
    const url = await comprobanteUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else setError('No se pudo abrir el comprobante')
  }

  function textoPago(p: PedidoTienda): string {
    const metodo = p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago] : 'Sin dato'
    if (p.pago_estado === 'pagado') return `${metodo} · Pagado`
    if (p.pago_estado === 'comprobante_subido') return `${metodo} · Comprobante recibido, falta revisar`
    return `${metodo} · Pago pendiente (cobrar al entregar)`
  }

  if (pedidos.length === 0) return null

  return (
    <section className="card">
      <h2>Pedidos de la tienda ({pedidos.length})</h2>
      <p className="subtitle">
        Pedidos de vecinos por entregar o por confirmar su pago.
      </p>
      {error && <p className="error-text">{error}</p>}
      {pedidos.map((p) => (
        <div key={p.id} className="pedido-tienda-item">
          <p>
            <strong>{p.nombre_cliente}</strong> — Torre {p.torre}, Depto {p.depto}
          </p>
          <p className="subtitle">{(items[p.id] ?? []).map(textoItem).join(', ')}</p>
          {(items[p.id] ?? [])
            .filter((it) => it.aprox)
            .map((it) => (
              <div key={it.id} className="report-row">
                <span>
                  <strong>Pesar:</strong> {it.nombre_producto} (pidió {it.unidades} un, ≈{' '}
                  {formatGramos(it.cantidad)})
                </span>
                {ajustando === it.id ? (
                  <>
                    <input
                      type="number"
                      min={10}
                      value={ajusteGramos}
                      onChange={(e) => setAjusteGramos(e.target.value)}
                      placeholder="Gramos reales"
                      className="qty-input"
                      autoFocus
                    />
                    <button className="btn btn-primary btn-small" onClick={() => handleAjustar(it.id)}>
                      Guardar peso
                    </button>
                    <button className="btn-link" onClick={() => setAjustando(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => {
                      setAjustando(it.id)
                      setAjusteGramos('')
                    }}
                  >
                    Ingresar peso real
                  </button>
                )}
              </div>
            ))}
          <p>
            Total: <strong>{formatCLP(p.total)}</strong>
          </p>
          <p className={p.pago_estado === 'comprobante_subido' ? 'info-text' : 'subtitle'}>
            {textoPago(p)}
          </p>
          <div className="report-row">
            {p.estado === 'pendiente' ? (
              <>
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
              </>
            ) : (
              <span className="subtitle">Entregado — falta confirmar el pago</span>
            )}
            {p.comprobante_path && (
              <button
                className="btn btn-secondary"
                onClick={() => verComprobante(p.comprobante_path as string)}
              >
                Ver comprobante
              </button>
            )}
            {p.pago_estado !== 'pagado' && (
              <button
                className="btn btn-primary"
                disabled={busyId === p.id}
                onClick={() => {
                  if (window.confirm(`¿Confirmas que el pedido de ${p.nombre_cliente} está pagado?`)) {
                    handlePagado(p.id)
                  }
                }}
              >
                Marcar pagado
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
