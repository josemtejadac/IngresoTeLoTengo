import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import { downloadProductosVendidosPdf } from '../lib/productosVendidosReport'
import { loadNameDirectory } from '../lib/directory'
import {
  loadPedidosTiendaDelDia,
  loadPedidoTiendaItems,
  type MetodoPago,
  METODO_PAGO_LABEL,
  type PedidoTienda,
  type PedidoTiendaItem,
} from '../lib/tienda'

type FiltroMetodo = 'todos' | MetodoPago

const METODOS_FILTRO: MetodoPago[] = ['efectivo', 'debito', 'credito', 'transferencia', 'qr', 'online', 'mixto']

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function textoMetodoPago(p: PedidoTienda): string {
  if (p.metodo_pago === 'mixto' && p.pago_mixto) {
    const partes = Object.entries(p.pago_mixto)
      .filter(([, monto]) => (monto ?? 0) > 0)
      .map(([m, monto]) => `${METODO_PAGO_LABEL[m as keyof typeof METODO_PAGO_LABEL]} ${formatCLP(monto ?? 0)}`)
    return partes.length > 0 ? `Mixto (${partes.join(' + ')})` : 'Pago mixto'
  }
  return p.metodo_pago ? METODO_PAGO_LABEL[p.metodo_pago] : 'Sin dato'
}

function textoItem(it: PedidoTiendaItem): string {
  if (!it.es_peso) {
    if (it.es_combo) return `${it.nombre_producto} (pack, ${it.cantidad} un)`
    return `${it.cantidad}x ${it.nombre_producto}`
  }
  const un = it.unidades ? `${it.unidades} un, ` : ''
  return `${it.nombre_producto} (${un}${it.aprox ? '≈ ' : ''}${formatGramos(it.cantidad)})`
}

export function HistorialPedidosTienda() {
  const [fecha, setFecha] = useState(hoyISO)
  const [pedidos, setPedidos] = useState<PedidoTienda[]>([])
  const [items, setItems] = useState<Record<string, PedidoTiendaItem[]>>({})
  const [error, setError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const [filtroWorker, setFiltroWorker] = useState('')
  const [filtroMetodo, setFiltroMetodo] = useState<FiltroMetodo>('todos')
  const [buscarMonto, setBuscarMonto] = useState('')

  useEffect(() => {
    loadNameDirectory().then(setNombres).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    try {
      const rows = await loadPedidosTiendaDelDia(fecha)
      setPedidos(rows)
      const entries = await Promise.all(
        rows.map(async (p) => [p.id, await loadPedidoTiendaItems(p.id)] as const),
      )
      setItems(Object.fromEntries(entries))
      setError(null)
    } catch {
      setError('Reconectando... la lista se actualiza sola en unos segundos.')
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

  const trabajadoresDelDia = [
    ...new Set(pedidos.map((p) => p.entregado_por).filter((id): id is string => !!id)),
  ]

  const montoBuscado = buscarMonto.replace(/\D/g, '')

  const filtrados = pedidos
    .filter((p) => !filtroWorker || p.entregado_por === filtroWorker)
    .filter((p) => filtroMetodo === 'todos' || p.metodo_pago === filtroMetodo)
    .filter((p) => !montoBuscado || String(p.total).includes(montoBuscado))
  const cuentasMetodo: Record<FiltroMetodo, number> = {
    todos: pedidos.length,
    efectivo: pedidos.filter((p) => p.metodo_pago === 'efectivo').length,
    debito: pedidos.filter((p) => p.metodo_pago === 'debito').length,
    credito: pedidos.filter((p) => p.metodo_pago === 'credito').length,
    transferencia: pedidos.filter((p) => p.metodo_pago === 'transferencia').length,
    qr: pedidos.filter((p) => p.metodo_pago === 'qr').length,
    tarjeta: pedidos.filter((p) => p.metodo_pago === 'tarjeta').length,
    online: pedidos.filter((p) => p.metodo_pago === 'online').length,
    mixto: pedidos.filter((p) => p.metodo_pago === 'mixto').length,
  }
  const total = filtrados.filter((p) => p.estado !== 'cancelado').reduce((sum, p) => sum + p.total, 0)

  return (
    <section className="card">
      <div className="section-header">
        <h2>Historial de pedidos de la tienda</h2>
        <div className="table-controls">
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          <select value={filtroWorker} onChange={(e) => setFiltroWorker(e.target.value)}>
            <option value="">Todos los trabajadores</option>
            {trabajadoresDelDia.map((id) => (
              <option key={id} value={id}>
                {nombres[id] ?? 'Desconocido'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={pdfBusy}
            onClick={async () => {
              setPdfError(null)
              setPdfBusy(true)
              try {
                await downloadProductosVendidosPdf(fecha)
              } catch (err) {
                setPdfError(err instanceof Error ? err.message : 'No se pudo generar el PDF')
              } finally {
                setPdfBusy(false)
              }
            }}
          >
            {pdfBusy ? 'Generando...' : '📄 PDF de productos vendidos'}
          </button>
        </div>
      </div>
      <div className="filtro-pago">
        <button
          type="button"
          className={filtroMetodo === 'todos' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
          onClick={() => setFiltroMetodo('todos')}
        >
          Todos ({cuentasMetodo.todos})
        </button>
        {METODOS_FILTRO.filter((m) => cuentasMetodo[m] > 0).map((m) => (
          <button
            key={m}
            type="button"
            className={filtroMetodo === m ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
            onClick={() => setFiltroMetodo(m)}
          >
            {METODO_PAGO_LABEL[m]} ({cuentasMetodo[m]})
          </button>
        ))}
      </div>
      <div className="table-controls">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Buscar por monto (ej. 4950)"
          value={buscarMonto}
          onChange={(e) => setBuscarMonto(e.target.value)}
        />
        {buscarMonto && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setBuscarMonto('')}>
            Limpiar
          </button>
        )}
      </div>
      {pdfError && <p className="error-text">{pdfError}</p>}
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
            {p.entregado_por && <> · Entregó: {nombres[p.entregado_por] ?? 'Desconocido'}</>}
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
              {textoMetodoPago(p)}
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
