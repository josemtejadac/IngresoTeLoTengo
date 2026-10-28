import { useCallback, useEffect, useRef, useState } from 'react'
import { useRealtimeRefresh } from '../lib/realtime'
import { useAuth } from '../lib/useAuth'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import { loadNameDirectory } from '../lib/directory'
import { AgregarProductoPedido } from './AgregarProductoPedido'
import { CambiarProductoItem } from './CambiarProductoItem'
import { EntregarMixto } from './EntregarMixto'
import { FiltroPagoBotones } from './FiltroPagoBotones'
import { PedidoManual } from './PedidoManual'
import { conTiempo, encolar, esErrorDeRed, guardarCache, leerCache, leerCola, procesarCola } from '../lib/pedidosOffline'
import {
  ajustarPesoItem,
  cambiarMetodoPedido,
  coincideFiltroPago,
  eliminarPedidoTienda,
  type FiltroPago,
  METODO_PAGO_LABEL,
  loadPedidosTiendaPendientes,
  loadFotosProductos,
  loadPromosIncluyen,
  loadPedidoTiendaItems,
  marcarEntregaFisica,
  productoFotoUrl,
  marcarPedidoTiendaEntregado,
  marcarProgresoPedido,
  quitarItemPedido,
  whatsappEnCaminoUrl,
  type PedidoTienda,
  type PedidoTiendaItem,
  type PromosIncluyen,
} from '../lib/tienda'

// Para evitar que se mezcle a quien cobra un pedido entre turnos (ya paso que un pedido de Ricardo quedo
// atribuido a Darlin y viceversa): de lunes a viernes antes de las 17:30, Ricardo solo puede marcar
// "Ya lo entregue" (entrega fisica); solo Darlin confirma el pago con "Entregado" en ese horario.
const RICARDO_ID = '798c0601-f744-48b5-b6b4-762669ae6073'
const DAVID_ID = '95bd2ec5-d274-4bb3-9239-a0bb8666b74f'

function horaSantiago(): { dia: number; minutos: number } {
  const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }))
  return { dia: ahora.getDay(), minutos: ahora.getHours() * 60 + ahora.getMinutes() }
}

// Solo "Ya lo entregue" queda habilitado para estos trabajadores en el horario indicado.
const BLOQUEO_ENTREGADO: Record<string, () => boolean> = {
  [RICARDO_ID]: () => {
    const { dia, minutos } = horaSantiago()
    return dia >= 1 && dia <= 5 && minutos < 17 * 60 + 30
  },
  // David: sabado y domingo hasta las 21:00 (cuando sale del turno).
  [DAVID_ID]: () => {
    const { dia, minutos } = horaSantiago()
    return (dia === 6 || dia === 0) && minutos < 21 * 60
  },
}

export function PedidosTienda() {
  const { session } = useAuth()
  const bloquearEntregado = !!session && BLOQUEO_ENTREGADO[session.user.id]?.() === true
  // Arranca con la ultima lista guardada en el telefono: si no hay señal al abrir, los pedidos se ven igual.
  const [cacheInicial] = useState(() => leerCache())
  const [pedidos, setPedidos] = useState<PedidoTienda[]>(() => cacheInicial?.pedidos ?? [])
  const [items, setItems] = useState<Record<string, PedidoTiendaItem[]>>(() => cacheInicial?.items ?? {})
  const [sinSenal, setSinSenal] = useState(false)
  const [enCola, setEnCola] = useState(() => leerCola().length)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<FiltroPago>('todos')
  const [ajustando, setAjustando] = useState<string | null>(null)
  const [ajusteGramos, setAjusteGramos] = useState('')
  const [fotos, setFotos] = useState<Record<string, string | null>>(() => cacheInicial?.fotos ?? {})
  const [promos, setPromos] = useState<PromosIncluyen>(() => cacheInicial?.promos ?? {})
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [nombres, setNombres] = useState<Record<string, string>>({})
  // Reloj para el "hace X min" de cada pedido.
  const [ahora, setAhora] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    loadNameDirectory().then(setNombres).catch(() => {})
  }, [])

  function alternarDetalle(id: string) {
    setAbiertos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (!abiertos.has(id)) {
      // Al abrir el detalle, el cliente ya puede ver "empacando tu pedido" (no se espera respuesta).
      marcarProgresoPedido(id, 'preparando').catch(() => {})
    }
  }

  // Cada recarga tiene un numero: si una respuesta vieja llega despues de una nueva, se descarta
  // (si no, un pedido ya entregado puede reaparecer unos segundos como pendiente).
  const ultimaCarga = useRef(0)

  const load = useCallback(async () => {
    const numero = ++ultimaCarga.current
    try {
      // Primero se envian las entregas que se marcaron sin señal (si ya volvio internet).
      if (leerCola().length > 0) await procesarCola()
      setEnCola(leerCola().length)
      const rows = (await loadPedidosTiendaPendientes()).filter(
        // Lo que se marco "Entregado" sin señal y aun no se envia no debe reaparecer como pendiente.
        (p) => !leerCola().some((a) => a.tipo === 'entregado' && a.id === p.id),
      )
      if (numero !== ultimaCarga.current) return
      setPedidos(rows)
      const entries = await Promise.all(
        rows.map(async (p) => [p.id, await loadPedidoTiendaItems(p.id)] as const),
      )
      if (numero !== ultimaCarga.current) return
      const itemsNuevos = Object.fromEntries(entries)
      setItems(itemsNuevos)
      const idsProductos = [...new Set(entries.flatMap(([, its]) => its.map((i) => i.producto_id).filter((x): x is string => !!x)))]
      const [fotosNuevas, promosNuevas] = await Promise.all([
        loadFotosProductos(idsProductos),
        loadPromosIncluyen(idsProductos).catch(() => ({}) as PromosIncluyen),
      ])
      if (numero !== ultimaCarga.current) return
      setFotos(fotosNuevas)
      setPromos(promosNuevas)
      guardarCache({ pedidos: rows, items: itemsNuevos, fotos: fotosNuevas, promos: promosNuevas })
      // Se limpia cualquier error viejo: si esto se ejecuto es porque la carga funciono.
      setError(null)
      setSinSenal(false)
    } catch {
      // Sin señal (o la app despertando de segundo plano): NO se borra nada, se mantiene la ultima lista conocida
      // y se reintenta sola (tiempo real + respaldo cada 8 s + al volver internet).
      setSinSenal(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Tiempo real, con respaldo cada 8 s por si el celular pierde la conexion en vivo (el celular bloqueado
  // corta el WebSocket y a veces no lo retoma solo hasta volver a abrir la app).
  useRealtimeRefresh(['ingreso_pedidos_tienda'], load, 8000)

  async function handleEntregado(p: PedidoTienda) {
    if (!window.confirm(`¿Marcar como entregado el pedido de ${p.nombre_cliente} (${formatCLP(p.total)})? Esto se suma a tu arqueo.`)) return
    setBusyId(p.id)
    setError(null)
    try {
      await conTiempo(marcarPedidoTiendaEntregado(p.id))
      // Sale de la lista al instante, sin esperar a la recarga.
      setPedidos((prev) => prev.filter((x) => x.id !== p.id))
      await load()
    } catch (err) {
      if (esErrorDeRed(err)) {
        // Sin señal: queda guardado en el telefono y se envia solo apenas vuelva internet.
        encolar({ tipo: 'entregado', id: p.id, cuando: Date.now() })
        setEnCola(leerCola().length)
        setPedidos((prev) => prev.filter((x) => x.id !== p.id))
        setError('Sin señal: la entrega quedó guardada y se enviará sola apenas vuelva internet.')
      } else {
        setError(err instanceof Error ? err.message : 'Error marcando el pedido')
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleQuitarItem(it: PedidoTiendaItem) {
    if (!window.confirm(`¿Quitar ${it.nombre_producto} de este pedido? Se devuelve el stock y se descuenta del total.`)) return
    setBusyId(it.id)
    setError(null)
    try {
      await quitarItemPedido(it.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error quitando el producto')
    } finally {
      setBusyId(null)
    }
  }

  async function handleEntregaFisica(p: PedidoTienda, entregar: boolean) {
    setBusyId(p.id)
    setError(null)
    try {
      await conTiempo(marcarEntregaFisica(p.id, entregar))
      await load()
    } catch (err) {
      if (esErrorDeRed(err)) {
        encolar({ tipo: 'entrega_fisica', id: p.id, entregar, cuando: Date.now() })
        setEnCola(leerCola().length)
        setError('Sin señal: quedó guardado y se enviará solo apenas vuelva internet.')
      } else {
        setError(err instanceof Error ? err.message : 'Error marcando la entrega')
      }
    } finally {
      setBusyId(null)
    }
  }

  async function handleEliminar(p: PedidoTienda) {
    if (!window.confirm(`¿Eliminar el pedido de ${p.nombre_cliente}? Esto es para pedidos hechos por error (ej. duplicados). No se puede deshacer.`)) return
    setBusyId(p.id)
    setError(null)
    try {
      await eliminarPedidoTienda(p.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error eliminando el pedido')
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
    if (!it.es_peso) {
      if (it.es_combo) return `${it.nombre_producto} (pack, ${it.cantidad} un)`
      return `${it.cantidad}x ${it.nombre_producto}`
    }
    const pedido = it.unidades ? `${it.unidades} un, ` : ''
    return `${it.nombre_producto} (${pedido}${it.aprox ? '≈ ' : ''}${formatGramos(it.cantidad)})`
  }

  async function handleCambiarMetodo(p: PedidoTienda, nuevo: 'efectivo' | 'tarjeta' | 'transferencia' | 'qr') {
    if (p.metodo_pago === nuevo) return
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

  function horaLlegada(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
  }

  function haceCuanto(iso: string, actual: number): string {
    const min = Math.max(0, Math.round((actual - new Date(iso).getTime()) / 60000))
    if (min < 1) return 'recién llegó'
    if (min < 60) return `hace ${min} min`
    const h = Math.floor(min / 60)
    if (h < 24) return `hace ${h} h ${min % 60} min`
    return `hace ${Math.floor(h / 24)} día(s)`
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
        {p.metodo_pago === 'efectivo' && p.pago_con ? (
          <>
            {' · '}
            <strong className="pago-con-aviso">
              Paga con {formatCLP(p.pago_con)} (vuelto {formatCLP(Math.max(0, p.pago_con - p.total))})
            </strong>
          </>
        ) : null}
      </>
    )
  }

  const cuentas: Record<FiltroPago, number> = {
    todos: pedidos.length,
    online: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'online')).length,
    efectivo: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'efectivo')).length,
    tarjeta: pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, 'tarjeta')).length,
  }
  const visibles = pedidos.filter((p) => coincideFiltroPago(p.metodo_pago, filtro))

  return (
    <section className="card">
      <div className="section-header">
        <h2>Pedidos de la tienda ({pedidos.length})</h2>
        <div className="table-controls">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => load()}>
            🔄 Refrescar
          </button>
          <PedidoManual onCreado={load} />
        </div>
      </div>
      {bloquearEntregado && (
        <p className="subtitle">
          ⏰ Por ahora solo puedes marcar "Ya lo entregué": el pago lo confirma el trabajador de turno con
          "Entregado" para que no se mezcle quién cobró cada pedido.
        </p>
      )}
      <FiltroPagoBotones value={filtro} onChange={setFiltro} cuentas={cuentas} />
      {sinSenal && (
        <p className="conexion-aviso">
          📶 Sin señal: sigues viendo tus últimos pedidos y puedes marcar entregas; todo se envía solo al volver internet.
        </p>
      )}
      {enCola > 0 && (
        <p className="conexion-aviso">⏳ {enCola} acción(es) guardada(s) esperando señal para enviarse.</p>
      )}
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
              <strong className="pedido-total">{formatCLP(p.total)}</strong>
            </div>
            {!!p.descuento_cupon && (
              <p className="pedido-cupon-aviso">
                🎟️ CON CUPÓN -{Math.round((p.descuento_cupon / (p.total + p.descuento_cupon)) * 100)}%: el cliente
                paga <strong>{formatCLP(p.total)}</strong> (subtotal {formatCLP(p.total + p.descuento_cupon)} menos{' '}
                {formatCLP(p.descuento_cupon)})
              </p>
            )}
            <p className="pedido-direccion">
              🏢 Torre <strong>{p.torre}</strong> · Depto <strong>{p.depto}</strong>
            </p>
            <p className="pedido-hora">
              🕒 Llegó a las <strong>{horaLlegada(p.created_at)}</strong> · {haceCuanto(p.created_at, ahora)}
            </p>
            {p.entrega_fisica_por && p.estado === 'pendiente' && (
              <p className="pedido-entrega-fisica">
                ✓ Ya lo entregó <strong>{nombres[p.entrega_fisica_por] ?? 'alguien'}</strong>
                {p.entrega_fisica_at && ` a las ${horaLlegada(p.entrega_fisica_at)}`} · falta confirmar
              </p>
            )}
            <div className="pedido-meta">{etiquetaPago(p)}</div>
            <button type="button" className="btn-detalle" onClick={() => alternarDetalle(p.id)}>
              {abiertos.has(p.id)
                ? 'Ocultar detalle ▴'
                : `Ver detalle del pedido · ${(items[p.id] ?? []).length} producto(s)${
                    (items[p.id] ?? []).some((it) => it.producto_id && promos[it.producto_id]) ? ' · 🎁 trae promo' : ''
                  } ▾`}
            </button>
            {abiertos.has(p.id) && (
              <div className="pedido-detalle">
                <p className="subtitle">
                  📞 <a href={`tel:${p.telefono_cliente}`}>{p.telefono_cliente}</a> · Hecho el{' '}
                  {new Date(p.created_at).toLocaleString('es-CL', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                {(items[p.id] ?? []).map((it) => {
                  const foto = it.producto_id ? fotos[it.producto_id] : null
                  return (
                    <div key={it.id} className="pedido-detalle-item">
                      {foto ? (
                        <img src={productoFotoUrl(foto)} alt="" className="pedido-detalle-foto" />
                      ) : (
                        <span className="pedido-detalle-foto pedido-detalle-foto-vacia">🛒</span>
                      )}
                      <span className="pedido-detalle-info">
                        <span className="pedido-detalle-nombre">{it.nombre_producto}</span>
                        <span className="subtitle">{textoItem(it).replace(it.nombre_producto, '').trim() || `${it.cantidad} un`}</span>
                        {it.producto_id && promos[it.producto_id] && (
                          <span className="pedido-promo-incluye">
                            <span className="pedido-promo-titulo">
                              🎁 PROMO{it.cantidad > 1 ? ` x${it.cantidad}` : ''} · saca estos productos:
                            </span>
                            {promos[it.producto_id].map((c) => (
                              <span key={c.nombre} className="pedido-promo-linea">
                                <strong>{c.cantidad * it.cantidad}</strong> × {c.nombre}
                              </span>
                            ))}
                          </span>
                        )}
                        {p.estado === 'pendiente' && (
                          <span className="pedido-detalle-acciones">
                            {!it.es_peso && !it.es_combo && (
                              <CambiarProductoItem itemId={it.id} onCambiado={load} />
                            )}
                            <button
                              type="button"
                              className="chip-accion chip-quitar"
                              disabled={busyId === it.id}
                              onClick={() => handleQuitarItem(it)}
                            >
                              ✕ Quitar
                            </button>
                          </span>
                        )}
                      </span>
                      <strong>{formatCLP(it.subtotal)}</strong>
                    </div>
                  )
                })}
                {p.estado === 'pendiente' && (
                  <AgregarProductoPedido pedidoId={p.id} onAgregado={load} />
                )}
              </div>
            )}
            {(items[p.id] ?? [])
              .filter((it) => it.es_peso)
              .map((it) => (
                <div key={it.id} className="pedido-pesar">
                  <span>
                    <strong>Pesar:</strong> {it.nombre_producto} (
                    {it.aprox ? `≈ ${formatGramos(it.cantidad)}` : formatGramos(it.cantidad)})
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
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={async () => {
                      // Se espera a que quede guardado ANTES de abrir WhatsApp: al abrir una app externa
                      // desde el celular, la pestaña puede quedar en pausa y cortar la llamada a mitad de camino.
                      try {
                        await marcarProgresoPedido(p.id, 'en_camino')
                      } catch {
                        // si falla el aviso, igual se abre WhatsApp
                      }
                      window.open(whatsappEnCaminoUrl(p.telefono_cliente), '_blank', 'noopener,noreferrer')
                    }}
                  >
                    Estoy en camino
                  </button>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={busyId === p.id || bloquearEntregado}
                    onClick={() => handleEntregado(p)}
                    title={
                      bloquearEntregado
                        ? 'Antes de las 17:30 solo puedes marcar "Ya lo entregué": Darlin confirma el pago'
                        : 'Confirma el pedido y suma la venta a tu arqueo'
                    }
                  >
                    {busyId === p.id ? '...' : 'Entregado'}
                  </button>
                  <button
                    type="button"
                    className={p.entrega_fisica_por ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
                    disabled={busyId === p.id}
                    title="Marca que ya saliste a entregarlo, sin sumarlo a tu arqueo (para cambio de turno)"
                    onClick={() => handleEntregaFisica(p, !p.entrega_fisica_por)}
                  >
                    {p.entrega_fisica_por ? '✓ Ya lo entregué' : '☐ Ya lo entregué'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger-outline btn-small"
                    disabled={busyId === p.id}
                    title="Eliminar pedido hecho por error (ej. duplicado)"
                    onClick={() => handleEliminar(p)}
                  >
                    🗑️ Eliminar
                  </button>
                </>
              )}
              {p.metodo_pago !== 'online' && p.estado === 'pendiente' && (
                <div className="metodo-cambiar">
                  {(['efectivo', 'tarjeta', 'transferencia', 'qr'] as const).map((m) => {
                    const bloqueado = m === 'tarjeta' && p.total < 1000
                    return (
                      <button
                        key={m}
                        type="button"
                        className={p.metodo_pago === m ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
                        disabled={busyId === p.id || bloqueado}
                        title={bloqueado ? 'Con menos de $1.000 no se puede con tarjeta' : undefined}
                        onClick={() => handleCambiarMetodo(p, m)}
                      >
                        {METODO_PAGO_LABEL[m]}
                      </button>
                    )
                  })}
                  {!bloquearEntregado && <EntregarMixto pedido={p} onEntregado={load} />}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
