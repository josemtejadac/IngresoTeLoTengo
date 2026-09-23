import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
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
  const [editing, setEditing] = useState<Producto | null>(null)
  const [editPrecio, setEditPrecio] = useState('')
  const [editStock, setEditStock] = useState('0')
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

  function openEdit(p: Producto) {
    setEditing(p)
    setEditPrecio(p.precio?.toString() ?? '')
    setEditStock(p.stock.toString())
    setError(null)
  }

  async function handleSave() {
    if (!editing) return
    const precio = editPrecio === '' ? null : Number(editPrecio)
    const stock = Number(editStock)
    if ((precio !== null && Number.isNaN(precio)) || Number.isNaN(stock)) {
      setError('Precio o stock inválido')
      return
    }
    setSavingId(editing.id)
    setError(null)
    try {
      await updateProducto(editing.id, { precio, stock })
      await runSearch()
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el producto')
    } finally {
      setSavingId(null)
    }
  }

  async function handleFoto(file: File | undefined) {
    if (!file || !editing) return
    setUploadingId(editing.id)
    setError(null)
    try {
      await uploadProductoFoto(editing.id, file)
      const rows = await loadProductos({ categoria: categoria || undefined, search: search || undefined })
      setProductos(rows)
      const updated = rows.find((r) => r.id === editing.id)
      if (updated) setEditing(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo la foto')
    } finally {
      setUploadingId(null)
    }
  }

  return (
    <section className="card">
      <h2>
        Inventario ({productos.length}
        {productos.length >= 100 ? '+' : ''} de la búsqueda)
      </h2>
      <p className="subtitle">
        Solo tú puedes editar precio, foto y stock. Escribe en el buscador o filtra por categoría —
        el catálogo completo tiene miles de productos.
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
      {error && !editing && <p className="error-text">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Foto</th>
            <th>Nombre</th>
            <th>Categoría</th>
            <th>Precio</th>
            <th>Stock</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {productos.map((p) => (
            <tr key={p.id}>
              <td>
                {p.foto_path ? (
                  <img src={productoFotoUrl(p.foto_path)} alt="" className="producto-thumb" />
                ) : (
                  '—'
                )}
              </td>
              <td>{p.nombre}</td>
              <td>{p.categoria ?? '—'}</td>
              <td>{p.precio !== null ? formatCLP(p.precio) : 'Sin precio'}</td>
              <td>{p.stock}</td>
              <td>
                <button className="btn btn-secondary btn-small" onClick={() => openEdit(p)}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editing && (
        <div className="camera-overlay">
          <div className="camera-modal">
            <h2>{editing.nombre}</h2>
            <p className="subtitle">
              {editing.categoria ?? '—'} · Código: {editing.codigo_barras ?? '—'}
            </p>

            {editing.foto_path ? (
              <img
                src={productoFotoUrl(editing.foto_path)}
                alt=""
                className="producto-preview"
              />
            ) : (
              <div className="producto-preview producto-preview-empty">Sin foto</div>
            )}
            <label>
              Foto (se comprime automáticamente)
              <input
                type="file"
                accept="image/*"
                disabled={uploadingId === editing.id}
                onChange={(e) => handleFoto(e.target.files?.[0])}
              />
            </label>

            <label>
              Precio
              <input
                type="number"
                min={0}
                value={editPrecio}
                onChange={(e) => setEditPrecio(e.target.value)}
              />
            </label>
            <label>
              Stock
              <input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
            </label>

            {error && <p className="error-text">{error}</p>}

            <div className="camera-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>
                Cerrar
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={savingId === editing.id}
              >
                {savingId === editing.id ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
