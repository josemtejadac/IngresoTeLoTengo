import { useCallback, useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { useRealtimeRefresh } from '../lib/realtime'
import {
  enviarCupon,
  loadClientesSeguimiento,
  loadCupones,
  loadPedidosCliente,
  telefonoParaWhatsapp,
  METODO_PAGO_LABEL,
  type ClienteSeguimiento,
  type Cupon,
  type MetodoPago,
  type PedidoCliente,
} from '../lib/tienda'

function linkWhatsappCupon(telefono: string, cupon: Cupon): string {
  const numero = telefonoParaWhatsapp(telefono)
  const mensaje = encodeURIComponent(
    `¡Hola! Te llegó un cupón de Te Lo Tengo Market 🎉\nCódigo: ${cupon.codigo}\nDescuento: ${cupon.descuento_pct}% en toda la tienda\nEscríbelo en el checkout de telotengomarket.cl para usarlo.`,
  )
  return `https://wa.me/${numero}?text=${mensaje}`
}

function mesActualISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split('-').map(Number)
  const desde = `${mes}-01`
  const ultimoDia = new Date(anio, m, 0).getDate()
  const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`
  return { desde, hasta }
}

function cuponVigente(c: Cupon): boolean {
  if (!c.activo) return false
  if (c.vence_at && new Date(c.vence_at) < new Date()) return false
  if (c.usos_maximos !== null && c.usos_actuales >= c.usos_maximos) return false
  return true
}

/** Seguimiento de clientes por depto: cuantas veces compraron y cuanto, para detectar clientes frecuentes a quien mandarles cupones. */
export function ClientesSeguimiento() {
  const [mes, setMes] = useState(mesActualISO)
  const [filas, setFilas] = useState<ClienteSeguimiento[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cupones, setCupones] = useState<Cupon[]>([])
  const [cuponElegido, setCuponElegido] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const [enviados, setEnviados] = useState<Record<string, boolean>>({})
  const [detalleAbierto, setDetalleAbierto] = useState<string | null>(null)
  const [detallePedidos, setDetallePedidos] = useState<Record<string, PedidoCliente[]>>({})
  const [detalleBusy, setDetalleBusy] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { desde, hasta } = rangoDelMes(mes)
      setFilas(await loadClientesSeguimiento(desde, hasta))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando el seguimiento de clientes')
    } finally {
      setBusy(false)
    }
  }, [mes])

  useEffect(() => {
    cargar()
  }, [cargar])

  const recargarCupones = useCallback(() => {
    loadCupones()
      .then(setCupones)
      .catch(() => {})
  }, [])
  useEffect(() => {
    recargarCupones()
  }, [recargarCupones])
  // Si se crea/desactiva un cupon en el formulario de arriba mientras esta pantalla esta abierta, se entera solo.
  useRealtimeRefresh(['ingreso_cupones'], recargarCupones)

  const cuponesVigentes = cupones.filter(cuponVigente)

  async function handleEnviar(f: ClienteSeguimiento) {
    const clave = `${f.torre}-${f.depto}`
    const cuponId = cuponElegido[clave]
    if (!cuponId || !f.telefono) return
    setEnviando(clave)
    setError(null)
    try {
      await enviarCupon(cuponId, f.telefono, f.torre, f.depto)
      setEnviados((prev) => ({ ...prev, [clave]: true }))
      setTimeout(() => setEnviados((prev) => ({ ...prev, [clave]: false })), 4000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error mandando el cupón')
    } finally {
      setEnviando(null)
    }
  }

  async function handleVerDetalle(f: ClienteSeguimiento) {
    const clave = `${f.torre}-${f.depto}`
    if (detalleAbierto === clave) {
      setDetalleAbierto(null)
      return
    }
    setDetalleAbierto(clave)
    if (detallePedidos[clave]) return
    setDetalleBusy(clave)
    try {
      const { desde, hasta } = rangoDelMes(mes)
      const pedidos = await loadPedidosCliente(f.torre, f.depto, desde, hasta)
      setDetallePedidos((prev) => ({ ...prev, [clave]: pedidos }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando el detalle')
    } finally {
      setDetalleBusy(null)
    }
  }

  const totalGastado = filas.reduce((sum, f) => sum + f.total, 0)
  const totalPedidos = filas.reduce((sum, f) => sum + f.pedidos, 0)

  return (
    <section className="card">
      <div className="section-header">
        <h2>Seguimiento de clientes (clientes potenciales)</h2>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>
      <p className="subtitle">
        Agrupado por torre/depto, ordenado de mayor a menor gasto. Si le mandas un cupón, le aparece en la tienda al
        instante (si tiene la página abierta) o apenas vuelva a entrar.
      </p>
      {error && <p className="error-text">{error}</p>}
      {busy && <p className="subtitle">Cargando...</p>}
      {!busy && filas.length === 0 && !error && (
        <p className="subtitle">No hay compras entregadas y pagadas ese mes.</p>
      )}
      {cuponesVigentes.length === 0 && filas.length > 0 && (
        <p className="subtitle">No tienes ningún cupón vigente para mandar — crea uno arriba primero.</p>
      )}
      {filas.length > 0 && (
        <>
          <p className="subtitle">
            {filas.length} depto(s) · {totalPedidos} pedido(s) · Total: <strong>{formatCLP(totalGastado)}</strong>
          </p>
          <div className="cliente-lista">
            {filas.map((f) => {
              const clave = `${f.torre}-${f.depto}`
              const abierto = detalleAbierto === clave
              return (
                <div key={clave} className="cliente-card">
                  <div className="cliente-card-head">
                    <strong>
                      Torre {f.torre}, depto {f.depto}
                    </strong>
                    <span className="cliente-card-total">{formatCLP(f.total)}</span>
                  </div>
                  <p className="subtitle cliente-card-sub">{f.nombre ?? 'Sin nombre'}</p>
                  <div className="cliente-card-montos">
                    <span className="arqueo-chip">{f.pedidos} pedido(s)</span>
                    <span className="arqueo-chip">Promedio {formatCLP(Math.round(f.total / f.pedidos))}</span>
                    <span className="arqueo-chip">
                      Última compra{' '}
                      {new Date(f.ultima_compra).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                    </span>
                    {f.telefono ? (
                      <a className="arqueo-chip cliente-chip-telefono" href={`tel:${f.telefono}`}>
                        📞 {f.telefono}
                      </a>
                    ) : (
                      <span className="arqueo-chip">Sin teléfono</span>
                    )}
                  </div>
                  <button type="button" className="btn-link-sutil" onClick={() => handleVerDetalle(f)}>
                    {abierto ? '▲ Ocultar detalle' : '▾ Ver detalle de sus pedidos'}
                  </button>
                  {abierto && (
                    <div className="cliente-detalle">
                      {detalleBusy === clave && <p className="subtitle">Cargando...</p>}
                      {detalleBusy !== clave && (detallePedidos[clave]?.length ?? 0) === 0 && (
                        <p className="subtitle">Sin pedidos en este rango.</p>
                      )}
                      {detallePedidos[clave]?.map((p) => (
                        <div key={p.id} className="cliente-detalle-fila">
                          <span>
                            {new Date(p.entregado_at).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}{' '}
                            · {METODO_PAGO_LABEL[p.metodo_pago as MetodoPago] ?? p.metodo_pago}
                          </span>
                          <strong>{formatCLP(p.total)}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="cliente-card-foot">
                    {enviados[clave] ? (
                      <span className="cupon-estado cupon-estado-vigente">✓ Cupón enviado</span>
                    ) : !f.telefono ? (
                      <span className="subtitle">Sin teléfono: no se le puede mandar cupón.</span>
                    ) : cuponesVigentes.length === 0 ? null : (
                      <div className="action-row">
                        <select
                          value={cuponElegido[clave] ?? ''}
                          onChange={(e) => setCuponElegido((prev) => ({ ...prev, [clave]: e.target.value }))}
                        >
                          <option value="">Elige un cupón...</option>
                          {cuponesVigentes.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.codigo} (-{c.descuento_pct}%)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="btn btn-cupon btn-small"
                          disabled={!cuponElegido[clave] || enviando === clave}
                          onClick={() => handleEnviar(f)}
                          title="Se lo manda dentro de la app, le aparece solo en la tienda"
                        >
                          {enviando === clave ? 'Enviando...' : '🎟️ Mandar en la app'}
                        </button>
                        {cuponElegido[clave] && (
                          <a
                            className="btn btn-secondary btn-small"
                            href={linkWhatsappCupon(
                              f.telefono,
                              cuponesVigentes.find((c) => c.id === cuponElegido[clave])!,
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Le manda el código por WhatsApp (por si no tiene la tienda abierta)"
                          >
                            📲 WhatsApp
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
