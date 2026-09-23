import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  loadCategorias,
  loadProductos,
  productoFotoUrl,
  updateProducto,
  uploadProductoFoto,
  type Producto,
} from '../lib/inventario'

export function InventarioAdmin() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [productos, setProductos] = useState<Producto[]>([])
  const [edits, setEdits] = useState<Record<string, { precio: string; stock: string }>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCategorias().then(setCategorias).catch(() => {})
  }, [])

  const runSearch = useCallback(async () => {
    try {
      const rows = await loadProductos({ categoria: categoria || undefined, search: search || undefined })
      setProductos(rows)
      setEdits(
        Object.fromEntries(
          rows.map((p) => [p.id, { precio: p.precio?.toString() ?? '', stock: p.stock.toString() }]),
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando productos')
    }
  }, [categoria, search])

  useEffect(() => {
    runSearch()
  }, [runSearch])

  useEffect(() => {
    const channel = supabase
      .channel('ingreso_productos_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_productos' }, () => {
        runSearch()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [runSearch])

  async function handleSave(producto: Producto) {
    const edit = edits[producto.id]
    if (!edit) return
    const precio = edit.precio === '' ? null : Number(edit.precio)
    const stock = Number(edit.stock)
    if ((precio !== null && Number.isNaN(precio)) || Number.isNaN(stock)) {
      setError('Precio o stock inválido')
      return
    }
    setSavingId(producto.id)
    setError(null)
    try {
      await updateProducto(producto.id, { precio, stock })
      await runSearch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el producto')
    } finally {
      setSavingId(null)
    }
  }

  async function handleFoto(producto: Producto, file: File | undefined) {
    if (!file) return
    setUploadingId(producto.id)
    setError(null)
    try {
      await uploadProductoFoto(producto.id, file)
      await runSearch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo la foto')
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <section className="card">
      <h2>Inventario ({productos.length}{productos.length >= 100 ? '+' : ''} de la búsqueda)</h2>
      <p className="subtitle">
        Solo tú puedes editar precio, nombre, foto y stock. Escribe en el buscador o filtra por
        categoría — el catálogo completo tiene miles de productos.
      </p>
      <div className="report-row">
        <label>
          Buscar por nombre o código de barras
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
      {error && <p className="error-text">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Foto</th>
            <th>Nombre</th>
            <th>Categoría</th>
            <th>Código de barras</th>
            <th>Precio</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => {
            const edit = edits[p.id] ?? { precio: '', stock: '0' }
            return (
              <tr key={p.id}>
                <td>
                  {p.foto_path ? (
                    <img src={productoFotoUrl(p.foto_path)} alt="" className="producto-thumb" />
                  ) : (
                    '—'
                  )}
                  <br />
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingId === p.id}
                    onChange={(e) => handleFoto(p, e.target.files?.[0])}
                  />
                </td>
                <td>{p.nombre}</td>
                <td>{p.categoria ?? '—'}</td>
                <td>{p.codigo_barras ?? '—'}</td>
                <td>
                  <input
                    type="number"
                    min={0}
                    className="qty-input"
                    value={edit.precio}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [p.id]: { ...edit, precio: e.target.value } }))
                    }
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="qty-input"
                    value={edit.stock}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [p.id]: { ...edit, stock: e.target.value } }))
                    }
                  />
                </td>
                <td>
                  <button
                    className="btn btn-secondary btn-small"
                    disabled={savingId === p.id}
                    onClick={() => handleSave(p)}
                  >
                    {savingId === p.id ? 'Guardando...' : 'Guardar'}
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
