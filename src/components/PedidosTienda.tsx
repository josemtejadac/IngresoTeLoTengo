import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import { FiltroPagoBotones } from './FiltroPagoBotones'
import { PedidoManual } from './PedidoManual'
import {
  ajustarPesoItem,
  cambiarMetodoPedido,
  coincideFiltroPago,
  type FiltroPago,
  marcarPedidoPagado,
  METODO_PAGO_LABEL,
  loadPedidosTiendaPendientes,
  loadPedidoTiendaItems,
  marcarPedidoTiendaEntregado,
  whatsappEnCaminoUrl,
  type PedidoTienda,
  type PedidoTiendaItem,
} from '../lib/tienda'

export function PedidosTienda() {
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([])
  const [items, setItems] = useState<Record<string, PedidoTiendaItem[]>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroPago>('todos')
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

  async function handleCambiarMetodo(p: PedidoTienda) {
    const nuevo = p.metodo_pago === 'tarjeta' ? 'efectivo' : 'tarjeta'
    if (!window.confirm(`¿Cambiar el pago de ${p.nombre_cliente} a ${METODO_PAGO_LABEL[nuevo]}?`)) return
    setBusyId(p.id)
    setError(null)
    try {
      await cambiarMetodoPedido(p.id, nuevo)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cambiando el método de pago')
    } finally {
      setBusyId(null)
    }
  }

  function etiquetaPago(p: PedidoTienda) {
    const metodo = p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago] : 'Sin dato'
    if (p.pago_estado === 'pagado') {
      return (
        <>
          {metodo} · <span className="badge-pagado">PAGADO</span>
        </>
      )
    }
    return (
      <>
        {metodo} · <span className="badge-pendiente">Pago pendiente</span> (cobrar al entregar)
      </>
    )
  }

  const cuentas: Record<FiltroPago, number> = {
    todos: pedidos.length,
    online: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'online')).length,
    contraentrega: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'contraentrega')).length,
  }
  const visibles = pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, filtro))

  return (
    <section className="card">
      <div className="section-header">
        <h2>Pedidos de la tienda ({pedidos.length})</h2>
        <PedidoManual onCreado={load} />
      </div>
      <FiltroPagoBotones value={filtro} onChange={setFiltro} cuentas={cuentas} />
      {error && <p className="error-text">{error}</p>}
      {visibles.length === 0 && <p className="subtitle">No hay pedidos con este filtro.</p>}
      <div className="pedidos-grid">
        {visibles.map((p) => (
          <div
            key={p.id}
            className={p.pago_estado === 'pagado' ? 'pedido-compacto pedido-pagado' : 'pedido-compacto'}
          >
            <div className="pedido-fila-top">
              <strong className="pedido-cliente">{p.nombre_cliente}</strong>
              <span className="pedido-dir">
                T{p.torre} · D{p.depto}
              </span>
              <strong className="pedido-total">{formatCLP(p.total)}</strong>
            </div>
            <div className="pedido-meta">{etiquetaPago(p)}</div>
            <p className="pedido-items">{(items[p.id] ?? []).map(textoItem).join(', ')}</p>
            {(items[p.id] ?? [])
              .filter((it) => it.aprox)
              .map((it) => (
                <div key={it.id} className="pedido-pesar">
                  <span>
                    <strong>Pesar:</strong> {it.nombre_producto} (≈ {formatGramos(it.cantidad)})
                  </span>
                  {ajustando === it.id ? (
                    <>
                      <input
                        type="number"
                        min={10}
                        value={ajusteGramos}
                        onChange={(e) => setAjusteGramos(e.target.value)}
                        placeholder="Gramos"
                        className="qty-input"
                        autoFocus
                      />
                      <button className="btn btn-primary btn-small" onClick={() => handleAjustar(it.id)}>
                        Guardar
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
                      Peso real
                    </button>
                  )}
                </div>
              ))}
            <div className="pedido-acciones">
              {p.estado === 'pendiente' && (
                <>
                  <a
                    className="btn btn-primary btn-small"
                    href={whatsappEnCaminoUrl(p.telefono_cliente)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Estoy en camino
                  </a>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={busyId === p.id}
                    onClick={() => handleEntregado(p.id)}
                  >
                    {busyId === p.id ? '...' : 'Entregado'}
                  </button>
                </>
              )}
              {p.metodo_pago !== 'online' && p.estado === 'pendiente' && (
                <button
                  className="btn btn-secondary btn-small"
                  disabled={busyId === p.id}
                  onClick={() => handleCambiarMetodo(p)}
                >
                  Cambiar a {p.metodo_pago === 'tarjeta' ? 'efectivo' : 'tarjeta'}
                </button>
              )}
              {p.pago_estado !== 'pagado' && (
                <button
                  className="btn btn-secondary btn-small"
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
      </div>
    </section>
  )
}
