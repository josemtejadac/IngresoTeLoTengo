import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCLP } from '../lib/payroll'
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
  // Solo se edita una fila a la vez: primero se toca Editar, recien ahi se pueden cambiar precio y stock.
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [borrador, setBorrador] = useState<Borrador>({ precio: '', stock: '' })
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error buscando productos')
    }
  }, [categoria, search])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  function empezarEdicion(p: Producto) {
    setError(null)
    setEditandoId(p.id)
    setBorrador(borradorDe(p))
  }

  function cancelarEdicion() {
    setEditandoId(null)
    setError(null)
  }

  async function guardar(p: Producto) {
    const precio = borrador.precio.trim() === '' ? null : Number(borrador.precio)
    const stock = Math.round(Number(borrador.stock))
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
      setEditandoId(null)
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
        Escanea con la pistola o busca por nombre para revisar el stock y el precio. Si algo está mal, toca Editar
        en ese producto, corrígelo y luego toca Guardar.
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
            const editando = editandoId === p.id
            return (
              <tr key={p.id} className={editando ? 'fila-editando' : undefined}>
                <td className="col-nombre">{p.nombre}</td>
                <td className="col-nombre">{p.categoria ?? '—'}</td>
                <td>
                  {editando ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        value={borrador.precio}
                        onChange={(e) => setBorrador((b) => ({ ...b, precio: e.target.value }))}
                        placeholder="Sin precio"
                        className="qty-input"
                        autoFocus
                      />
                      {p.por_peso && <span className="subtitle"> /kg</span>}
                    </>
                  ) : p.precio !== null ? (
                    `${formatCLP(p.precio)}${p.por_peso ? ' /kg' : ''}`
                  ) : (
                    <span className="subtitle">Sin precio</span>
                  )}
                </td>
                <td>
                  {editando ? (
                    <>
                      <input
                        type="number"
                        min={0}
                        value={borrador.stock}
                        onChange={(e) => setBorrador((b) => ({ ...b, stock: e.target.value }))}
                        className="qty-input"
                      />
                      {p.por_peso && <span className="subtitle"> g</span>}
                    </>
                  ) : p.por_peso ? (
                    `${p.stock} g`
                  ) : (
                    p.stock
                  )}
                </td>
                <td>
                  {editando ? (
                    <div className="table-controls">
                      <button
                        className="btn btn-primary btn-small"
                        disabled={guardandoId === p.id}
                        onClick={() => guardar(p)}
                      >
                        {guardandoId === p.id ? 'Guardando...' : 'Guardar'}
                      </button>
                      <button className="btn btn-secondary btn-small" onClick={cancelarEdicion}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={editandoId !== null}
                      onClick={() => empezarEdicion(p)}
                    >
                      Editar
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
