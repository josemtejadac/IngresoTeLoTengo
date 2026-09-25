import { useCallback, useEffect, useRef, useState } from 'react'
import { FiltroStockBotones } from './FiltroStockBotones'
import {
  actualizarPrecioStock,
  coincideFiltroStock,
  loadCategorias,
  loadProductos,
  type FiltroStock,
  type Producto,
} from '../lib/inventario'

interface Borrador {
  precio: string
  stock: string
}

function borradorDe(p: Producto): Borrador {
  return { precio: p.precio !== null ? String(p.precio) : '', stock: String(p.stock) }
}

export function ProductosScanner() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [resultados, setResultados] = useState<Producto[]>([])
  const [filtroStock, setFiltroStock] = useState<FiltroStock>('todos')
  const [error, setError] = useState<string | null>(null)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)
  const buscarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCategorias().then(setCategorias).catch(() => {})
  }, [])

  const runSearch = useCallback(async () => {
    try {
      // Limite alto: para que los filtros de sin precio/sin stock/bajo stock vean todo el inventario activo.
      const rows = await loadProductos({ categoria: categoria || undefined, search: search || undefined, limit: 500 })
      setResultados(rows)
      setBorradores((prev) => {
        const next = { ...prev }
        for (const p of rows) if (!next[p.id]) next[p.id] = borradorDe(p)
        return next
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error buscando productos')
    }
  }, [categoria, search])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  function setCampo(id: string, campo: keyof Borrador, valor: string) {
    setBorradores((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valor } }))
  }

  function esModificado(p: Producto): boolean {
    const b = borradores[p.id]
    if (!b) return false
    const original = borradorDe(p)
    return b.precio !== original.precio || b.stock !== original.stock
  }

  async function guardar(p: Producto) {
    const b = borradores[p.id]
    if (!b) return
    const precio = b.precio.trim() === '' ? null : Number(b.precio)
    const stock = Math.round(Number(b.stock))
    if (precio !== null && (Number.isNaN(precio) || precio < 0)) {
      setError(`Precio inválido para ${p.nombre}.`)
      return
    }
    if (Number.isNaN(stock) || stock < 0) {
      setError(`Stock inválido para ${p.nombre}.`)
      return
    }
    setGuardandoId(p.id)
    setError(null)
    try {
      await actualizarPrecioStock(p.id, precio, stock)
      setResultados((prev) => prev.map((x) => (x.id === p.id ? { ...x, precio, stock } : x)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el producto')
    } finally {
      setGuardandoId(null)
    }
  }

  const cuentas: Record<FiltroStock, number> = {
    todos: resultados.length,
    sinprecio: resultados.filter((p) => coincideFiltroStock(p, 'sinprecio')).length,
    sinstock: resultados.filter((p) => coincideFiltroStock(p, 'sinstock')).length,
    bajostock: resultados.filter((p) => coincideFiltroStock(p, 'bajostock')).length,
  }
  const visibles = resultados.filter((p) => coincideFiltroStock(p, filtroStock))

  return (
    <section className="card">
      <h2>Productos</h2>
      <p className="subtitle">
        Escanea con la pistola o busca por nombre para revisar el stock y el precio. Si algo está mal, corrígelo
        aquí mismo y toca Guardar.
      </p>

      <label className="chat-input">
        Código de barras o nombre
        <input
          ref={buscarInputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Escanea o escribe, ej: coca cola"
          autoFocus
        />
      </label>
      {error && <p className="error-text">{error}</p>}

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

      <FiltroStockBotones value={filtroStock} onChange={setFiltroStock} cuentas={cuentas} />

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
          {visibles.map((p) => {
            const b = borradores[p.id] ?? borradorDe(p)
            const modificado = esModificado(p)
            return (
              <tr key={p.id}>
                <td className="col-nombre">{p.nombre}</td>
                <td className="col-nombre">{p.categoria ?? '—'}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={b.precio}
                    onChange={(e) => setCampo(p.id, 'precio', e.target.value)}
                    placeholder="Sin precio"
                    className="qty-input"
                  />
                  {p.por_peso && <span className="subtitle"> /kg</span>}
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    value={b.stock}
                    onChange={(e) => setCampo(p.id, 'stock', e.target.value)}
                    className="qty-input"
                  />
                  {p.por_peso && <span className="subtitle"> g</span>}
                </td>
                <td>
                  {modificado && (
                    <button
                      className="btn btn-primary btn-small"
                      disabled={guardandoId === p.id}
                      onClick={() => guardar(p)}
                    >
                      {guardandoId === p.id ? 'Guardando...' : 'Guardar'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
          {visibles.length === 0 && (
            <tr>
              <td colSpan={5} className="subtitle">
                No hay productos con ese filtro.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="subtitle">
        Precio: el precio de venta al público (por kilo en los productos por peso). Stock: unidades disponibles
        (gramos en los productos por peso).
      </p>
    </section>
  )
}
