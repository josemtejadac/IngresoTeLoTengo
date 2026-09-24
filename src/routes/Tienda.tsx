import { useCallback, useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { Stepper } from '../components/Stepper'
import { useAtrasCierra } from '../lib/atras'
import { formatCLP } from '../lib/payroll'
import { formatGramos, montoPorPeso } from '../lib/peso'
import { guardarCliente, loadClienteGuardado, olvidarCliente } from '../lib/clienteGuardado'
import {
  crearPedidoTienda,
  cancelarPedidoCliente,
  guardarPedidoIdLocal,
  loadProductosPorIds,
  iniciarPagoFlow,
  loadMisPedidos,
  METODO_PAGO_LABEL,
  type MetodoPago,
  type MiPedido,
  loadCatalogoTienda,
  loadCategoriasTienda,
  productoFotoUrl,
  type ProductoTienda,
} from '../lib/tienda'

interface CartLine {
  producto: ProductoTienda
  /** Unidades normales, o (por peso) unidades aproximadas / gramos segun el modo. */
  cantidad: number
  modo?: 'unidades' | 'gramos'
}

function gramosLinea(l: CartLine): number {
  if (!l.producto.por_peso) return 0
  return l.modo === 'unidades' ? l.cantidad * (l.producto.gramos_unidad ?? 0) : l.cantidad
}

function totalLinea(l: CartLine): number {
  return l.producto.por_peso
    ? montoPorPeso(l.producto.precio, gramosLinea(l))
    : l.producto.precio * l.cantidad
}

const GRAMOS_RAPIDOS = [100, 250, 500, 1000]

export function Tienda() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [detalle, setDetalle] = useState<ProductoTienda | null>(null)
  const [detalleCant, setDetalleCant] = useState(1)
  const [pesoSel, setPesoSel] = useState<{
    producto: ProductoTienda
    modo: 'unidades' | 'gramos'
    valor: string
  } | null>(null)
  const [guardado, setGuardado] = useState(loadClienteGuardado)
  const [nombre, setNombre] = useState(guardado?.nombre ?? '')
  const [telefono, setTelefono] = useState(guardado?.telefono ?? '')
  const [torre, setTorre] = useState(guardado?.direcciones[guardado.ultima]?.torre ?? '')
  const [depto, setDepto] = useState(guardado?.direcciones[guardado.ultima]?.depto ?? '')
  // 'nueva' = escribir otra direccion; numero = indice de una direccion guardada
  const [dirSel, setDirSel] = useState<number | 'nueva'>(
    guardado && guardado.direcciones.length > 0 ? guardado.ultima : 'nueva',
  )
  const [guardarDatos, setGuardarDatos] = useState(true)
  const [email, setEmail] = useState(guardado?.email ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<{
    total: number
    pedidoId: string
    metodo: MetodoPago
  } | null>(null)
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo')
  const [verHistorial, setVerHistorial] = useState(false)
  // Vuelta desde Flow: ?pago=ok|pendiente|fallo&pedido=<id>
  const [retorno, setRetorno] = useState<{ pago: string; pedido: MiPedido | null } | null>(null)
  const [misPedidos, setMisPedidos] = useState<MiPedido[] | null>(null)

  useAtrasCierra(detalle !== null, () => setDetalle(null))
  useAtrasCierra(showCheckout, () => setShowCheckout(false))
  useAtrasCierra(pesoSel !== null, () => setPesoSel(null))
  useAtrasCierra(verHistorial, () => setVerHistorial(false))

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const pago = q.get('pago')
    const pedidoId = q.get('pedido')
    if (!pago || !pedidoId) return
    window.history.replaceState(null, '', window.location.pathname)
    let vivo = true
    let intentos = 0
    async function cargar() {
      try {
        const lista = await loadMisPedidos()
        const ped = lista.find((x) => x.id === pedidoId) ?? null
        if (!vivo) return
        setRetorno({ pago: ped?.pago_estado === 'pagado' ? 'ok' : (pago as string), pedido: ped })
        // Flow puede tardar unos segundos en avisar: se reintenta un rato.
        if (ped && ped.pago_estado === 'esperando_pago' && intentos++ < 12) setTimeout(cargar, 4000)
      } catch {
        if (vivo) setRetorno({ pago: pago as string, pedido: null })
      }
    }
    cargar()
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    loadCategoriasTienda().then(setCategorias).catch(() => {})
  }, [])

  const runSearch = useCallback(async () => {
    try {
      const rows = await loadCatalogoTienda({
        search: search || undefined,
        categoria: categoria || undefined,
      })
      setProductos(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando el catálogo')
    }
  }, [search, categoria])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  function abrirPeso(producto: ProductoTienda) {
    const existente = cart.find((l) => l.producto.id === producto.id)
    const modo = existente?.modo ?? (producto.gramos_unidad ? 'unidades' : 'gramos')
    setPesoSel({
      producto,
      modo,
      valor: existente ? String(existente.cantidad) : modo === 'unidades' ? '1' : '250',
    })
  }

  function confirmarPeso() {
    if (!pesoSel) return
    const n = Math.round(Number(pesoSel.valor))
    const minimo = pesoSel.modo === 'gramos' ? 50 : 1
    if (!n || n < minimo) return
    setCart((prev) => [
      ...prev.filter((l) => l.producto.id !== pesoSel.producto.id),
      { producto: pesoSel.producto, cantidad: n, modo: pesoSel.modo },
    ])
    setPesoSel(null)
  }

  function enCarrito(productoId: string): number {
    return cart.find((l) => l.producto.id === productoId)?.cantidad ?? 0
  }

  function addToCart(producto: ProductoTienda, cantidad = 1) {
    if (producto.por_peso) {
      abrirPeso(producto)
      return
    }
    const max = producto.stock_max ?? Infinity
    if (enCarrito(producto.id) >= max) {
      setError(`Solo hay ${max} unidad(es) disponible(s) de ${producto.nombre}.`)
      return
    }
    setError(null)
    setCart((prev) => {
      const existing = prev.find((l) => l.producto.id === producto.id)
      if (existing) {
        return prev.map((l) =>
          l.producto.id === producto.id
            ? { ...l, cantidad: Math.min(max, l.cantidad + cantidad) }
            : l,
        )
      }
      return [...prev, { producto, cantidad: Math.min(max, cantidad) }]
    })
  }

  function abrirDetalle(producto: ProductoTienda) {
    setDetalle(producto)
    setDetalleCant(1)
  }

  function updateCantidad(productoId: string, cantidad: number) {
    setCart((prev) =>
      cantidad <= 0
        ? prev.filter((l) => l.producto.id !== productoId)
        : prev.map((l) => (l.producto.id === productoId ? { ...l, cantidad } : l)),
    )
  }

  function elegirDireccion(value: string) {
    if (value === 'nueva') {
      setDirSel('nueva')
      setTorre('')
      setDepto('')
      return
    }
    const idx = Number(value)
    setDirSel(idx)
    setTorre(guardado?.direcciones[idx]?.torre ?? '')
    setDepto(guardado?.direcciones[idx]?.depto ?? '')
  }

  function handleOlvidar() {
    olvidarCliente()
    setGuardado(null)
    setDirSel('nueva')
    setNombre('')
    setTelefono('')
    setEmail('')
    setTorre('')
    setDepto('')
  }

  const total = cart.reduce((sum, l) => sum + totalLinea(l), 0)
  const hayAprox = cart.some((l) => l.producto.por_peso && l.modo === 'unidades')

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault()
    if (cart.length === 0) return
    if (metodo === 'online' && total < 350) {
      setError('El pago online requiere un mínimo de $350.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await crearPedidoTienda({
        nombre,
        telefono,
        torre,
        depto,
        metodo,
        items: cart.map((l) => {
          if (!l.producto.por_peso) return { producto_id: l.producto.id, cantidad: l.cantidad }
          return l.modo === 'unidades'
            ? { producto_id: l.producto.id, unidades: l.cantidad }
            : { producto_id: l.producto.id, gramos: l.cantidad }
        }),
      })
      if (guardarDatos) {
        guardarCliente({ nombre, telefono, email, torre, depto })
        const c = loadClienteGuardado()
        setGuardado(c)
        if (c) setDirSel(c.ultima)
      }
      guardarPedidoIdLocal(result.pedido_id)
      if (metodo === 'online') {
        // Se lleva al cliente a Flow; al pagar vuelve a la tienda con el pedido.
        window.location.href = await iniciarPagoFlow(result.pedido_id, email.trim())
        return
      }
      setConfirmacion({ total: result.total, pedidoId: result.pedido_id, metodo })
      setCart([])
      setShowCheckout(false)
      if (!guardarDatos) {
        setNombre('')
        setTelefono('')
        setTorre('')
        setDepto('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando el pedido')
    } finally {
      setBusy(false)
    }
  }

  const [busyPedido, setBusyPedido] = useState<string | null>(null)

  async function pagarPedido(p: MiPedido) {
    let correo = email.trim()
    if (!correo) correo = (window.prompt('¿A qué correo te enviamos el comprobante de Flow?') ?? '').trim()
    if (!correo) return
    setBusyPedido(p.id)
    try {
      window.location.href = await iniciarPagoFlow(p.id, correo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar el pago')
      setBusyPedido(null)
    }
  }

  async function cancelarPedido(p: MiPedido) {
    if (!window.confirm('¿Cancelar este pedido? No se te cobrará nada.')) return
    setBusyPedido(p.id)
    try {
      await cancelarPedidoCliente(p.id)
      setMisPedidos(await loadMisPedidos())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar el pedido')
    } finally {
      setBusyPedido(null)
    }
  }

  /** Editar = cancelar el pedido sin pagar y devolver sus productos al carrito para agregar mas. */
  async function editarPedido(p: MiPedido) {
    const sinPagar = p.estado !== 'cancelado'
    if (
      sinPagar &&
      !window.confirm('Se cancela este pedido y sus productos vuelven a tu carrito para que puedas agregar más. ¿Seguimos?')
    ) {
      return
    }
    setBusyPedido(p.id)
    try {
      if (sinPagar) await cancelarPedidoCliente(p.id)
      const ids = p.items.map((it) => it.producto_id).filter((x): x is string => !!x)
      const prods = new Map((await loadProductosPorIds(ids)).map((x) => [x.id, x]))
      const lineas: CartLine[] = []
      let faltan = 0
      for (const it of p.items) {
        const prod = it.producto_id ? prods.get(it.producto_id) : undefined
        if (!prod) {
          faltan++
          continue
        }
        if (!prod.por_peso) {
          lineas.push({ producto: prod, cantidad: Math.min(it.cantidad, prod.stock_max ?? it.cantidad) })
        } else if (it.aprox && it.unidades) {
          lineas.push({ producto: prod, cantidad: it.unidades, modo: 'unidades' })
        } else {
          lineas.push({ producto: prod, cantidad: it.cantidad, modo: 'gramos' })
        }
      }
      setCart(lineas)
      setMetodo('online')
      setVerHistorial(false)
      setShowCheckout(true)
      setError(faltan > 0 ? `${faltan} producto(s) del pedido ya no están disponibles.` : null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo editar el pedido')
    } finally {
      setBusyPedido(null)
    }
  }

  async function abrirHistorial() {
    setVerHistorial(true)
    setMisPedidos(null)
    try {
      setMisPedidos(await loadMisPedidos())
    } catch (err) {
      setMisPedidos([])
      setError(err instanceof Error ? err.message : 'Error cargando tus pedidos')
    }
  }

  if (retorno) {
    const ped = retorno.pedido
    const pagado = ped?.pago_estado === 'pagado'
    return (
      <div className="page-center">
        <div className={pagado ? 'card login-form retorno-pago' : 'card login-form'}>
          <div className="login-brand">
            <Logo size={72} />
            {pagado ? (
              <h1>¡Pago recibido!</h1>
            ) : retorno.pago === 'fallo' ? (
              <h1>Pago no completado</h1>
            ) : (
              <h1>Confirmando tu pago...</h1>
            )}
          </div>
          {pagado && (
            <p>
              <span className="badge-pagado">PAGADO</span> · Tu pedido está <strong>en curso</strong>. Un
              vecino de Te Lo Tengo Market te va a escribir por WhatsApp cuando esté abajo.
            </p>
          )}
          {!pagado && retorno.pago === 'fallo' && (
            <p>No se realizó el cobro. Tu pedido aparece en «Mis pedidos», desde ahí puedes volver a pedirlo.</p>
          )}
          {!pagado && retorno.pago !== 'fallo' && (
            <p className="subtitle">Estamos esperando la confirmación de Flow. Esto tarda unos segundos.</p>
          )}
          {ped && (
            <p className="subtitle">
              Total: <strong>{formatCLP(ped.total)}</strong> ·{' '}
              {ped.items
                .map((it) =>
                  it.es_peso ? `${it.nombre_producto} (${formatGramos(it.cantidad)})` : `${it.cantidad}x ${it.nombre_producto}`,
                )
                .join(', ')}
            </p>
          )}
          <button className="btn btn-primary" onClick={() => setRetorno(null)}>
            Volver a la tienda
          </button>
        </div>
      </div>
    )
  }

  if (confirmacion) {
    return (
      <div className="page-center">
        <div className="card login-form">
          <div className="login-brand">
            <Logo size={72} />
            <h1>¡Pedido recibido!</h1>
          </div>
          <p className="subtitle">
            Total: <strong>{formatCLP(confirmacion.total)}</strong> · Pago:{' '}
            {METODO_PAGO_LABEL[confirmacion.metodo]} al recibir
          </p>
          <p>Un vecino de Te Lo Tengo Market te va a escribir por WhatsApp cuando esté abajo.</p>
          <button className="btn btn-primary" onClick={() => setConfirmacion(null)}>
            Hacer otro pedido
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="tienda-hero">
        <div className="tienda-hero-top">
          <div className="brand-row">
            <Logo size={52} />
            <div>
              <h1>Te Lo Tengo Market</h1>
              <p>Delivery dentro del condominio</p>
            </div>
          </div>
          <button className="tienda-pedidos-btn" onClick={abrirHistorial}>
            🧾 Mis pedidos
          </button>
        </div>
        <div className="tienda-beneficios">
          <span>🚚 Te lo llevamos a tu depto</span>
          <span>💳 Paga online o al recibir</span>
        </div>
        <input
          type="search"
          className="tienda-buscar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  ¿Qué necesitas? Ej: coca cola"
          aria-label="Buscar producto"
        />
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className="tienda-chips" role="tablist" aria-label="Categorías">
        <button
          type="button"
          className={categoria === '' ? 'tienda-chip activo' : 'tienda-chip'}
          onClick={() => setCategoria('')}
        >
          Todas
        </button>
        {categorias.map((c) => (
          <button
            key={c}
            type="button"
            className={categoria === c ? 'tienda-chip activo' : 'tienda-chip'}
            onClick={() => setCategoria(c)}
          >
            {c.replace(/\s+/g, ' ').trim()}
          </button>
        ))}
      </div>

      {productos.length === 0 && <p className="subtitle">No encontramos productos con esa búsqueda.</p>}

      <div className="tienda-grid">
        {productos.map((p) => (
          <div key={p.id} className="tienda-card">
            <button type="button" className="tienda-abrir" onClick={() => abrirDetalle(p)}>
              {p.foto_path ? (
                <img src={productoFotoUrl(p.foto_path)} alt={p.nombre} className="tienda-foto" />
              ) : (
                <div className="tienda-foto tienda-foto-placeholder">🛒</div>
              )}
              <p className="tienda-nombre">{p.nombre}</p>
            </button>
            <p className="tienda-precio">
              {formatCLP(p.precio)}
              {p.por_peso ? ' /kg' : ''}
            </p>
            <button
              className="btn btn-primary btn-small"
              disabled={!p.disponible}
              onClick={() => addToCart(p)}
            >
              {p.disponible ? '+ Agregar' : 'Sin stock'}
            </button>
          </div>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="tienda-cart-bar">
          <span>
            {cart.length} producto(s) · {hayAprox ? '≈ ' : ''}
            {formatCLP(total)}
          </span>
          <button className="btn btn-primary" onClick={() => setShowCheckout(true)}>
            Ver pedido
          </button>
        </div>
      )}

      {showCheckout && (
        <div className="camera-overlay">
          <div className="camera-modal">
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowCheckout(false)}>
                ← Volver
              </button>
              <h2>Tu pedido</h2>
            </div>
            <table className="table">
              <tbody>
                {cart.map((l) => (
                  <tr key={l.producto.id}>
                    <td className="col-nombre">{l.producto.nombre}</td>
                    <td>
                      {l.producto.por_peso ? (
                        <>
                          {l.modo === 'unidades'
                            ? `${l.cantidad} un (≈ ${formatGramos(gramosLinea(l))})`
                            : formatGramos(l.cantidad)}{' '}
                          <button className="btn-link" onClick={() => abrirPeso(l.producto)}>
                            Cambiar
                          </button>
                        </>
                      ) : (
                        <Stepper
                          value={l.cantidad}
                          min={1}
                          max={l.producto.stock_max}
                          onChange={(v) => updateCantidad(l.producto.id, v)}
                        />
                      )}
                    </td>
                    <td>
                      {l.producto.por_peso && l.modo === 'unidades' ? '≈ ' : ''}
                      {formatCLP(totalLinea(l))}
                    </td>
                    <td>
                      <button className="btn-link" onClick={() => updateCantidad(l.producto.id, 0)}>
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Total: <strong>{hayAprox ? '≈ ' : ''}{formatCLP(total)}</strong>
            </p>
            {hayAprox && (
              <p className="subtitle">
                Lo pedido por unidad es aproximado: se pesa al armar tu pedido y el valor final se
                ajusta al peso real.
              </p>
            )}

            <form onSubmit={handleCheckout} className="worker-form">
              <label>
                Nombre
                <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
              </label>
              <label>
                Teléfono (WhatsApp)
                <input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  placeholder="+56 9 1234 5678"
                  required
                />
              </label>
              {guardado && guardado.direcciones.length > 0 && (
                <label>
                  Dirección de entrega
                  <select value={String(dirSel)} onChange={(e) => elegirDireccion(e.target.value)}>
                    {guardado.direcciones.map((d, i) => (
                      <option key={i} value={i}>
                        Torre {d.torre}, depto {d.depto}
                      </option>
                    ))}
                    <option value="nueva">Otra dirección…</option>
                  </select>
                </label>
              )}
              {dirSel === 'nueva' && (
                <>
                  <label>
                    Torre
                    <input value={torre} onChange={(e) => setTorre(e.target.value)} required />
                  </label>
                  <label>
                    Depto
                    <input value={depto} onChange={(e) => setDepto(e.target.value)} required />
                  </label>
                </>
              )}
              {metodo === 'online' && (
                <label>
                  Correo (Flow te envía el comprobante)
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tucorreo@ejemplo.com"
                    required
                  />
                </label>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={guardarDatos}
                  onChange={(e) => setGuardarDatos(e.target.checked)}
                />
                Guardar mis datos para la próxima vez
              </label>
              {guardado && (
                <button type="button" className="btn-link" onClick={handleOlvidar}>
                  Borrar mis datos guardados
                </button>
              )}
              <fieldset className="pago-metodos">
                <legend>¿Cómo pagas?</legend>
                {(['efectivo', 'tarjeta'] as MetodoPago[]).map((m) => (
                  <label key={m} className="checkbox-label">
                    <input
                      type="radio"
                      name="metodo"
                      checked={metodo === m}
                      onChange={() => setMetodo(m)}
                    />
                    {METODO_PAGO_LABEL[m]} al recibir
                  </label>
                ))}
                <label className="checkbox-label">
                  <input
                    type="radio"
                    name="metodo"
                    checked={metodo === 'online'}
                    onChange={() => setMetodo('online')}
                  />
                  Pago online (Flow) — tarjeta o transferencia
                </label>
              </fieldset>
              {error && <p className="error-text">{error}</p>}
              <div className="report-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCheckout(false)}
                >
                  Seguir comprando
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Enviando...' : metodo === 'online' ? 'Ir a pagar' : 'Confirmar pedido'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {pesoSel && (
        <div className="camera-overlay">
          <form
            className="camera-modal"
            onSubmit={(e) => {
              e.preventDefault()
              confirmarPeso()
            }}
          >
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setPesoSel(null)}>
                ← Volver
              </button>
              <h2>{pesoSel.producto.nombre}</h2>
            </div>
            <p className="subtitle">{formatCLP(pesoSel.producto.precio)} el kilo</p>
            {pesoSel.producto.gramos_unidad && (
              <div className="action-row">
                <button
                  type="button"
                  className={pesoSel.modo === 'unidades' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
                  onClick={() => setPesoSel({ ...pesoSel, modo: 'unidades', valor: '1' })}
                >
                  Por unidad
                </button>
                <button
                  type="button"
                  className={pesoSel.modo === 'gramos' ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
                  onClick={() => setPesoSel({ ...pesoSel, modo: 'gramos', valor: '500' })}
                >
                  Por gramos
                </button>
              </div>
            )}
            {pesoSel.modo === 'gramos' && (
              <div className="action-row">
                {GRAMOS_RAPIDOS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setPesoSel({ ...pesoSel, valor: String(g) })}
                  >
                    {formatGramos(g)}
                  </button>
                ))}
              </div>
            )}
            <p className="campo-etiqueta">
              {pesoSel.modo === 'unidades' ? 'Cantidad de unidades' : 'Gramos (mínimo 50)'}
            </p>
            <div className="peso-controles">
              <Stepper
                value={Math.round(Number(pesoSel.valor)) || 0}
                min={pesoSel.modo === 'gramos' ? 50 : 1}
                step={pesoSel.modo === 'gramos' ? 50 : 1}
                label={
                  pesoSel.modo === 'gramos'
                    ? formatGramos(Math.round(Number(pesoSel.valor)) || 0)
                    : undefined
                }
                onChange={(v) => setPesoSel({ ...pesoSel, valor: String(v) })}
              />
              <input
                type="number"
                min={pesoSel.modo === 'gramos' ? 50 : 1}
                value={pesoSel.valor}
                onChange={(e) => setPesoSel({ ...pesoSel, valor: e.target.value })}
                aria-label="Cantidad exacta"
                className="peso-input"
              />
            </div>
            {(() => {
              const n = Math.round(Number(pesoSel.valor)) || 0
              const g = pesoSel.modo === 'unidades' ? n * (pesoSel.producto.gramos_unidad ?? 0) : n
              return (
                <p>
                  {pesoSel.modo === 'unidades' && <>≈ {formatGramos(g)} · </>}
                  {pesoSel.modo === 'unidades' ? 'Aprox: ' : 'Monto: '}
                  <strong>{formatCLP(montoPorPeso(pesoSel.producto.precio, g))}</strong>
                </p>
              )
            })()}
            {pesoSel.modo === 'unidades' && (
              <p className="subtitle">El peso real se mide al armar el pedido; el valor final se ajusta.</p>
            )}
            <div className="camera-actions">
              <button type="submit" className="btn btn-primary">
                Agregar al pedido
              </button>
            </div>
          </form>
        </div>
      )}

      {verHistorial && (
        <div className="camera-overlay">
          <div className="camera-modal">
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setVerHistorial(false)}>
                ← Volver
              </button>
              <h2>Mis pedidos</h2>
            </div>
            {misPedidos === null && <p className="subtitle">Cargando...</p>}
            {misPedidos !== null && misPedidos.length === 0 && (
              <p className="subtitle">
                Todavía no tienes pedidos en este teléfono. Aquí verás los que hagas desde ahora.
              </p>
            )}
            {(misPedidos ?? []).map((p) => (
              <div
                key={p.id}
                className={p.pago_estado === 'pagado' ? 'pedido-tienda-item pedido-pagado' : 'pedido-tienda-item'}
              >
                <p>
                  <strong>
                    {new Date(p.created_at).toLocaleString('es-CL', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </strong>{' '}
                  · {p.estado === 'entregado'
                    ? 'Entregado'
                    : p.estado === 'cancelado'
                      ? p.metodo_pago === 'online' && p.pago_estado !== 'pagado'
                        ? 'Pago no completado'
                        : 'Cancelado'
                      : p.pago_estado === 'esperando_pago'
                        ? 'Sin pagar'
                        : 'En curso'}
                </p>
                <p className="subtitle">
                  {p.items
                    .map((it) =>
                      it.es_peso
                        ? `${it.nombre_producto} (${it.unidades ? `${it.unidades} un, ` : ''}${it.aprox ? '≈ ' : ''}${formatGramos(it.cantidad)})`
                        : `${it.cantidad}x ${it.nombre_producto}`,
                    )
                    .join(', ')}
                </p>
                <p>
                  Total: <strong>{formatCLP(p.total)}</strong>
                  {p.metodo_pago ? ` · ${METODO_PAGO_LABEL[p.metodo_pago]}` : ''}
                  {' · '}
                  {p.pago_estado === 'pagado' ? (
                    <span className="badge-pagado">PAGADO</span>
                  ) : p.pago_estado === 'esperando_pago' ? (
                    <span className="badge-pendiente">Esperando pago</span>
                  ) : (
                    <span className="badge-pendiente">Pago pendiente</span>
                  )}
                </p>
                {p.metodo_pago === 'online' && p.pago_estado === 'esperando_pago' && p.estado !== 'cancelado' && (
                  <div className="report-row">
                    <button
                      className="btn btn-primary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => pagarPedido(p)}
                    >
                      Pagar ahora
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => editarPedido(p)}
                    >
                      Editar / agregar más
                    </button>
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => cancelarPedido(p)}
                    >
                      Cancelar pedido
                    </button>
                  </div>
                )}
                {p.metodo_pago === 'online' && p.pago_estado !== 'pagado' && p.estado === 'cancelado' && (
                  <div className="report-row">
                    <button
                      className="btn btn-primary btn-small"
                      disabled={busyPedido === p.id}
                      onClick={() => editarPedido(p)}
                    >
                      Volver a pedir
                    </button>
                  </div>
                )}
              </div>
            ))}
            <div className="camera-actions">
              <button className="btn btn-secondary" onClick={() => setVerHistorial(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {detalle && (
        <div className="camera-overlay" onClick={() => setDetalle(null)}>
          <div className="camera-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-top">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setDetalle(null)}>
                ← Volver
              </button>
            </div>
            {detalle.foto_path ? (
              <img src={productoFotoUrl(detalle.foto_path)} alt={detalle.nombre} className="detalle-foto" />
            ) : (
              <div className="detalle-foto detalle-foto-vacia">Sin foto</div>
            )}
            <h2 className="detalle-nombre">{detalle.nombre}</h2>
            <p className="detalle-precio">
              {formatCLP(detalle.precio)}
              {detalle.por_peso ? ' el kilo' : ''}
            </p>
            {enCarrito(detalle.id) > 0 && !detalle.por_peso && (
              <p className="subtitle">Ya tienes {enCarrito(detalle.id)} en tu pedido.</p>
            )}
            {detalle.por_peso ? (
              <button
                className="btn btn-primary"
                onClick={() => {
                  const p = detalle
                  setDetalle(null)
                  abrirPeso(p)
                }}
              >
                Elegir cantidad
              </button>
            ) : (
              <>
                <div className="detalle-cantidad">
                  <Stepper
                    value={detalleCant}
                    min={1}
                    max={detalle.stock_max !== null ? Math.max(1, detalle.stock_max - enCarrito(detalle.id)) : null}
                    onChange={setDetalleCant}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    addToCart(detalle, detalleCant)
                    setDetalle(null)
                  }}
                >
                  Agregar · {formatCLP(detalle.precio * detalleCant)}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
