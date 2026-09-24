import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { formatGramos, montoPorPeso } from '../lib/peso'
import {
  crearPedido,
  loadCategorias,
  loadProductoPorBarra,
  loadProductos,
  type Producto,
} from '../lib/inventario'

interface CartLine {
  producto: Producto
  /** Unidades, o gramos si el producto es por peso. */
  cantidad: number
}

function subtotalLinea(l: CartLine): number {
  const precio = l.producto.precio ?? 0
  return l.producto.por_peso ? montoPorPeso(precio, l.cantidad) : precio * l.cantidad
}

export function ProductosScanner() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [resultados, setResultados] = useState<Producto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [pedidoBusy, setPedidoBusy] = useState(false)
  const [pedidoMessage, setPedidoMessage] = useState<string | null>(null)
  const [pesoProducto, setPesoProducto] = useState<Producto | null>(null)
  const [pesoGramos, setPesoGramos] = useState('')
  const barraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCategorias().then(setCategorias).catch(() => {})
  }, [])

  const runSearch = useCallback(async () => {
    try {
      const rows = await loadProductos({ categoria: categoria || undefined, search: search || undefined })
      setResultados(rows)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Error buscando productos')
    }
  }, [categoria, search])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  function addToCart(producto: Producto) {
    if (producto.por_peso) {
      // Los productos por peso piden los gramos (lo que marca la balanza).
      setPesoProducto(producto)
      setPesoGramos('')
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

  function confirmarPeso() {
    const gramos = Math.round(Number(pesoGramos))
    if (!pesoProducto || !gramos || gramos < 10) return
    setCart((prev) => {
      const sinEste = prev.filter((l) => l.producto.id !== pesoProducto.id)
      return [...sinEste, { producto: pesoProducto, cantidad: gramos }]
    })
    setPesoProducto(null)
    setPesoGramos('')
    barraInputRef.current?.focus()
  }

  function updateCantidad(productoId: string, cantidad: number) {
    setCart((prev) =>
      cantidad <= 0
        ? prev.filter((l) => l.producto.id !== productoId)
        : prev.map((l) => (l.producto.id === productoId ? { ...l, cantidad } : l)),
    )
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    const term = search.trim()
    if (!term) return
    setScanError(null)
    try {
      // Si coincide exactamente con un codigo de barras (pistola), se agrega directo al pedido.
      const producto = await loadProductoPorBarra(term)
      if (!producto) {
        if (resultados.length === 0) setScanError(`No se encontró ningún producto con "${term}"`)
        return
      }
      if (producto.precio === null) {
        setScanError(`"${producto.nombre}" todavía no tiene precio configurado.`)
      } else {
        addToCart(producto)
      }
      setSearch('')
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Error buscando el producto')
    } finally {
      barraInputRef.current?.focus()
    }
  }

  const total = cart.reduce((sum, l) => sum + subtotalLinea(l), 0)

  async function handleGenerarPedido() {
    if (cart.length === 0) return
    setPedidoBusy(true)
    setPedidoMessage(null)
    try {
      const { total: pedidoTotal } = await crearPedido(
        cart.map((l) =>
          l.producto.por_peso
            ? { producto_id: l.producto.id, gramos: l.cantidad }
            : { producto_id: l.producto.id, cantidad: l.cantidad },
        ),
      )
      setPedidoMessage(`Pedido generado: ${formatCLP(pedidoTotal)}`)
      setCart([])
      await runSearch()
    } catch (err) {
      setPedidoMessage(null)
      setScanError(err instanceof Error ? err.message : 'Error generando el pedido')
    } finally {
      setPedidoBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Productos</h2>
      <p className="subtitle">Escanea con la pistola o busca por nombre para armar un pedido.</p>

      <form onSubmit={handleScan} className="report-row">
        <label className="chat-input">
          Código de barras o nombre
          <input
            ref={barraInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Escanea o escribe, ej: coca cola"
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Agregar
        </button>
      </form>
      {scanError && <p className="error-text">{scanError}</p>}

      <div className="report-row">
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

      <table className="table">
        <thead>
          <tr>
            <th>Producto</th>
            <th>Categoría</th>
            <th>Precio</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {resultados.map((p) => (
            <tr key={p.id}>
              <td className="col-nombre">{p.nombre}</td>
              <td className="col-nombre">{p.categoria ?? '—'}</td>
              <td>{p.precio !== null ? `${formatCLP(p.precio)}${p.por_peso ? ' /kg' : ''}` : 'Sin precio'}</td>
              <td>{p.por_peso ? '—' : p.stock}</td>
              <td>
                <button
                  className="btn-link"
                  disabled={p.precio === null}
                  onClick={() => addToCart(p)}
                >
                  Agregar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {cart.length > 0 && (
        <>
          <h2>Pedido</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Subtotal</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((l) => (
                <tr key={l.producto.id}>
                  <td className="col-nombre">{l.producto.nombre}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={l.producto.por_peso ? 10 : 1}
                      value={l.cantidad}
                      onChange={(e) => updateCantidad(l.producto.id, Number(e.target.value))}
                      className="qty-input"
                    />
                    {l.producto.por_peso && <span className="subtitle"> g ({formatGramos(l.cantidad)})</span>}
                  </td>
                  <td>{formatCLP(subtotalLinea(l))}</td>
                  <td>
                    <button className="btn-link" onClick={() => updateCantidad(l.producto.id, 0)}>
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Total</strong>
                </td>
                <td colSpan={2}>
                  <strong>{formatCLP(total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
          {pedidoMessage && <p className="info-text">{pedidoMessage}</p>}
          <button className="btn btn-primary" onClick={handleGenerarPedido} disabled={pedidoBusy}>
            {pedidoBusy ? 'Generando...' : 'Generar pedido'}
          </button>
        </>
      )}

      {pesoProducto && (
        <div className="camera-overlay">
          <form
            className="camera-modal"
            onSubmit={(e) => {
              e.preventDefault()
              confirmarPeso()
            }}
          >
            <h2>{pesoProducto.nombre}</h2>
            <p className="subtitle">
              {formatCLP(pesoProducto.precio ?? 0)} el kilo. Escribe los gramos que marca la balanza.
            </p>
            <label>
              Gramos
              <input
                type="number"
                min={10}
                step={1}
                value={pesoGramos}
                onChange={(e) => setPesoGramos(e.target.value)}
                autoFocus
              />
            </label>
            <p>
              Monto:{' '}
              <strong>
                {formatCLP(montoPorPeso(pesoProducto.precio ?? 0, Math.round(Number(pesoGramos)) || 0))}
              </strong>
            </p>
            <div className="camera-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPesoProducto(null)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={!(Number(pesoGramos) >= 10)}>
                Agregar al pedido
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
