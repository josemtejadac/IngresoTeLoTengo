import { useCallback, useEffect, useState } from 'react'
import { Logo } from '../components/Logo'
import { formatCLP } from '../lib/payroll'
import {
  crearPedidoTienda,
  loadCatalogoTienda,
  loadCategoriasTienda,
  productoFotoUrl,
  type ProductoTienda,
} from '../lib/tienda'

interface CartLine {
  producto: ProductoTienda
  cantidad: number
}

export function Tienda() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [torre, setTorre] = useState('')
  const [depto, setDepto] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState<{ total: number } | null>(null)

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

  function addToCart(producto: ProductoTienda) {
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

  const total = cart.reduce((sum, l) => sum + l.producto.precio * l.cantidad, 0)

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
        items: cart.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
      })
      setConfirmacion({ total: result.total })
      setCart([])
      setShowCheckout(false)
      setNombre('')
      setTelefono('')
      setTorre('')
      setDepto('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generando el pedido')
    } finally {
      setBusy(false)
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
            Total: <strong>{formatCLP(confirmacion.total)}</strong>
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
        <label>
          Buscar
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ej: coca cola" />
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
            <p className="tienda-precio">{formatCLP(p.precio)}</p>
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
            {cart.reduce((n, l) => n + l.cantidad, 0)} producto(s) · {formatCLP(total)}
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
                      <input
                        type="number"
                        min={1}
                        value={l.cantidad}
                        onChange={(e) => updateCantidad(l.producto.id, Number(e.target.value))}
                        className="qty-input"
                      />
                    </td>
                    <td>{formatCLP(l.producto.precio * l.cantidad)}</td>
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
              Total: <strong>{formatCLP(total)}</strong>
            </p>

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
              <label>
                Torre
                <input value={torre} onChange={(e) => setTorre(e.target.value)} required />
              </label>
              <label>
                Depto
                <input value={depto} onChange={(e) => setDepto(e.target.value)} required />
              </label>
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
    </div>
  )
}
