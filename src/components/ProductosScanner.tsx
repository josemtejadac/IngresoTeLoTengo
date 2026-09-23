import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import {
  crearPedido,
  loadCategorias,
  loadProductoPorBarra,
  loadProductos,
  type Producto,
} from '../lib/inventario'

interface CartLine {
  producto: Producto
  cantidad: number
}

export function ProductosScanner() {
  const [open, setOpen] = useState(false)
  const [barra, setBarra] = useState('')
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [resultados, setResultados] = useState<Producto[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [pedidoBusy, setPedidoBusy] = useState(false)
  const [pedidoMessage, setPedidoMessage] = useState<string | null>(null)
  const barraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    loadCategorias().then(setCategorias).catch(() => {})
  }, [open])

  const runSearch = useCallback(async () => {
    try {
      const rows = await loadProductos({ categoria: categoria || undefined, search: search || undefined })
      setResultados(rows)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Error buscando productos')
    }
  }, [categoria, search])

  useEffect(() => {
    if (!open) return
    runSearch()
  }, [open, runSearch])

  function addToCart(producto: Producto) {
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

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    if (!barra.trim()) return
    setScanError(null)
    try {
      const producto = await loadProductoPorBarra(barra.trim())
      if (!producto) {
        setScanError(`No se encontró ningún producto con el código ${barra.trim()}`)
      } else if (producto.precio === null) {
        setScanError(`"${producto.nombre}" todavía no tiene precio configurado.`)
      } else {
        addToCart(producto)
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Error buscando el producto')
    } finally {
      setBarra('')
      barraInputRef.current?.focus()
    }
  }

  const total = cart.reduce((sum, l) => sum + (l.producto.precio ?? 0) * l.cantidad, 0)

  async function handleGenerarPedido() {
    if (cart.length === 0) return
    setPedidoBusy(true)
    setPedidoMessage(null)
    try {
      const { total: pedidoTotal } = await crearPedido(
        cart.map((l) => ({ producto_id: l.producto.id, cantidad: l.cantidad })),
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

  if (!open) {
    return (
      <section className="card">
        <div className="section-header">
          <h2>Productos</h2>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            Armar pedido
          </button>
        </div>
        <p className="subtitle">Escanea con la pistola o busca productos para armar un pedido.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2>Armar pedido</h2>
        <button className="btn btn-secondary" onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </div>
      <p className="subtitle">Escanea con la pistola (o escribe el código) para armar un pedido.</p>

      <form onSubmit={handleScan} className="report-row">
        <label>
          Código de barras
          <input
            ref={barraInputRef}
            value={barra}
            onChange={(e) => setBarra(e.target.value)}
            autoFocus
            inputMode="numeric"
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Agregar
        </button>
      </form>
      {scanError && <p className="error-text">{scanError}</p>}

      <div className="report-row">
        <label>
          Buscar por nombre
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
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
              <td>{p.nombre}</td>
              <td>{p.categoria ?? '—'}</td>
              <td>{p.precio !== null ? formatCLP(p.precio) : 'Sin precio'}</td>
              <td>{p.stock}</td>
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
                  <td>{formatCLP((l.producto.precio ?? 0) * l.cantidad)}</td>
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
    </section>
  )
}
