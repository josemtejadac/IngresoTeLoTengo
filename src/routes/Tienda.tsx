import { useCallback, useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { formatCLP } from '../lib/payroll'
import { formatGramos, montoPorPeso } from '../lib/peso'
import { guardarCliente, loadClienteGuardado, olvidarCliente } from '../lib/clienteGuardado'
import {
  crearPedidoTienda,
  loadDatosTransferencia,
  METODO_PAGO_LABEL,
  subirComprobante,
  type MetodoPago,
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<{
    total: number
    pedidoId: string
    metodo: MetodoPago
  } | null>(null)
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo')
  const [datosTransf, setDatosTransf] = useState('')
  const [comprobante, setComprobante] = useState<File | null>(null)
  const [comprobanteBusy, setComprobanteBusy] = useState(false)
  const [comprobanteOk, setComprobanteOk] = useState(false)
  const [comprobanteError, setComprobanteError] = useState<string | null>(null)

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

  function addToCart(producto: ProductoTienda) {
    if (producto.por_peso) {
      abrirPeso(producto)
      return
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.producto.id === producto.id)
      if (existing) {
        return prev.map((l) =>
          l.producto.id === producto.id ? { ...l, cantidad: l.cantidad + 1 } : l,
        )
      }
      return [...prev, { producto, cantidad: 1 }]
    })
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
    setTorre('')
    setDepto('')
  }

  const total = cart.reduce((sum, l) => sum + totalLinea(l), 0)
  const hayAprox = cart.some((l) => l.producto.por_peso && l.modo === 'unidades')

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault()
    if (cart.length === 0) return
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
        guardarCliente({ nombre, telefono, torre, depto })
        const c = loadClienteGuardado()
        setGuardado(c)
        if (c) setDirSel(c.ultima)
      }
      setConfirmacion({ total: result.total, pedidoId: result.pedido_id, metodo })
      setComprobante(null)
      setComprobanteOk(false)
      setComprobanteError(null)
      if (metodo === 'transferencia') loadDatosTransferencia().then(setDatosTransf).catch(() => {})
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

  async function handleSubirComprobante() {
    if (!confirmacion || !comprobante || comprobanteBusy) return
    setComprobanteBusy(true)
    setComprobanteError(null)
    try {
      await subirComprobante(confirmacion.pedidoId, comprobante)
      setComprobanteOk(true)
    } catch (err) {
      setComprobanteError(err instanceof Error ? err.message : 'No se pudo subir el comprobante')
    } finally {
      setComprobanteBusy(false)
    }
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
          {confirmacion.metodo === 'transferencia' && (
            <>
              <p>Transfiere el total a:</p>
              <p className="pago-datos">{datosTransf || 'Te enviaremos los datos por WhatsApp.'}</p>
              {comprobanteOk ? (
                <p className="info-text">
                  ¡Comprobante recibido! Lo revisaremos y confirmaremos tu pago.
                </p>
              ) : (
                <>
                  <label>
                    Sube la captura de tu transferencia
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setComprobante(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  {comprobanteError && <p className="error-text">{comprobanteError}</p>}
                  <button
                    className="btn btn-primary"
                    disabled={!comprobante || comprobanteBusy}
                    onClick={handleSubirComprobante}
                  >
                    {comprobanteBusy ? 'Subiendo...' : 'Enviar comprobante'}
                  </button>
                  <p className="subtitle">
                    Puedes subirlo ahora o pagar al recibir tu pedido.
                  </p>
                </>
              )}
            </>
          )}
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
      <header className="page-header">
        <div className="brand-row">
          <Logo size={48} />
          <div>
            <h1>Te Lo Tengo Market</h1>
            <p className="subtitle">Delivery dentro del condominio</p>
          </div>
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}

      <div className="report-row">
        <label className="chat-input">
          Buscar producto
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Escribe el nombre, ej: coca cola"
          />
        </label>
        <label>
          Categoría
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="tienda-grid">
        {productos.map((p) => (
          <div key={p.id} className="tienda-card">
            {p.foto_path ? (
              <img src={productoFotoUrl(p.foto_path)} alt={p.nombre} className="tienda-foto" />
            ) : (
              <div className="tienda-foto tienda-foto-placeholder" />
            )}
            <p className="tienda-nombre">{p.nombre}</p>
            <p className="tienda-precio">
              {formatCLP(p.precio)}
              {p.por_peso ? ' /kg' : ''}
            </p>
            <button
              className="btn btn-primary btn-small"
              disabled={!p.disponible}
              onClick={() => addToCart(p)}
            >
              {p.disponible ? 'Agregar' : 'Sin stock'}
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
            <h2>Tu pedido</h2>
            <table className="table">
              <tbody>
                {cart.map((l) => (
                  <tr key={l.producto.id}>
                    <td>{l.producto.nombre}</td>
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
                        <input
                          type="number"
                          min={1}
                          value={l.cantidad}
                          onChange={(e) => updateCantidad(l.producto.id, Number(e.target.value))}
                          className="qty-input"
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
                {(['efectivo', 'transferencia', 'tarjeta'] as MetodoPago[]).map((m) => (
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
                <label className="checkbox-label pago-disabled">
                  <input type="radio" name="metodo" disabled />
                  Pago online (Flow) — próximamente
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
                  {busy ? 'Enviando...' : 'Confirmar pedido'}
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
            <h2>{pesoSel.producto.nombre}</h2>
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
            <label>
              {pesoSel.modo === 'unidades' ? 'Cantidad de unidades' : 'Gramos (mínimo 50)'}
              <input
                type="number"
                min={pesoSel.modo === 'gramos' ? 50 : 1}
                value={pesoSel.valor}
                onChange={(e) => setPesoSel({ ...pesoSel, valor: e.target.value })}
                autoFocus
              />
            </label>
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
              <button type="button" className="btn btn-secondary" onClick={() => setPesoSel(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary">
                Agregar al pedido
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
