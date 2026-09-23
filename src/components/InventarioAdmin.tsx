import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import {
  activarProductoPorBarra,
  crearProductoNuevo,
  loadCategorias,
  loadProductos,
  productoFotoUrl,
  updateProducto,
  uploadProductoFoto,
  type Producto,
} from '../lib/inventario'

export function InventarioAdmin() {
  const [open, setOpen] = useState(false)
  const [catalogoOculto, setCatalogoOculto] = useState(false)
  const [scanBarra, setScanBarra] = useState('')
  const [sumarStock, setSumarStock] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [nuevoBarra, setNuevoBarra] = useState<string | null>(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevaCategoria, setNuevaCategoria] = useState('')
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
    if (!open) return
    loadCategorias(catalogoOculto).then(setCategorias).catch(() => {})
  }, [open, catalogoOculto])

  const runSearch = useCallback(async () => {
    try {
      const rows = await loadProductos({
        categoria: categoria || undefined,
        search: search || undefined,
        soloInactivos: catalogoOculto,
      })
      setProductos(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando productos')
    }
  }, [categoria, search, catalogoOculto])

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    const code = scanBarra.trim()
    if (!code) return
    setScanError(null)
    setScanMessage(null)
    setNuevoBarra(null)
    try {
      const result = await activarProductoPorBarra(code, sumarStock)
      if (result.tipo === 'no_encontrado') {
        setNuevoBarra(code)
        setNuevoNombre('')
        setNuevaCategoria('')
      } else if (result.tipo === 'activado') {
        setScanMessage(`Activado: ${result.producto.nombre}`)
      } else {
        setScanMessage(
          `Ya estaba en tu inventario: ${result.producto.nombre} (stock ${result.producto.stock})`,
        )
      }
      await runSearch()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Error escaneando el producto')
    } finally {
      setScanBarra('')
    }
  }

  async function handleCrearNuevo(e: React.FormEvent) {
    e.preventDefault()
    if (!nuevoBarra || !nuevoNombre.trim()) return
    setScanError(null)
    try {
      const p = await crearProductoNuevo({
        codigo_barras: nuevoBarra,
        nombre: nuevoNombre,
        categoria: nuevaCategoria,
        stock: sumarStock ? 1 : 0,
      })
      setScanMessage(`Producto nuevo creado: ${p.nombre}`)
      setNuevoBarra(null)
      await runSearch()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Error creando el producto')
    }
  }

  async function handleActivar(p: Producto) {
    setError(null)
    try {
      await updateProducto(p.id, { active: true })
      await runSearch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error activando el producto')
    }
  }

  async function handleOcultar(p: Producto | null = editing) {
    if (!p) return
    if (!window.confirm(`¿Ocultar "${p.nombre}"? Dejará de aparecer en la tienda y en los pedidos.`)) {
      return
    }
    setError(null)
    try {
      await updateProducto(p.id, { active: false })
      setEditing(null)
      await runSearch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error ocultando el producto')
    }
  }

  useEffect(() => {
    if (!open) return
    runSearch()
  }, [open, runSearch])

  useEffect(() => {
    if (!open) return
    const channel = supabase
      .channel('ingreso_productos_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_productos' }, () => {
        runSearch()
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [open, runSearch])

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

  if (!open) {
    return (
      <section className="card">
        <div className="section-header">
          <h2>Inventario</h2>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            Inventario
          </button>
        </div>
        <p className="subtitle">Buscar, editar precio, stock y foto de los productos.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2>
          Inventario ({productos.length}
          {productos.length >= 100 ? '+' : ''} de la búsqueda)
        </h2>
        <button className="btn btn-secondary" onClick={() => setOpen(false)}>
          Cerrar
        </button>
      </div>
      <p className="subtitle">
        Aquí ves solo los productos que ya escaneaste (tu inventario real). Escanea con la pistola
        para activar cada producto del catálogo; los que no estén en el catálogo los puedes crear
        al momento.
      </p>

      <form onSubmit={handleScan} className="report-row">
        <label>
          Escanear código de barras
          <input
            value={scanBarra}
            onChange={(e) => setScanBarra(e.target.value)}
            inputMode="numeric"
            autoFocus
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Activar
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={sumarStock}
            onChange={(e) => setSumarStock(e.target.checked)}
          />
          Sumar 1 al stock por cada escaneo
        </label>
      </form>
      {scanMessage && <p className="info-text">{scanMessage}</p>}
      {scanError && <p className="error-text">{scanError}</p>}

      {nuevoBarra && (
        <form onSubmit={handleCrearNuevo} className="worker-form">
          <p>
            El código <strong>{nuevoBarra}</strong> no está en el catálogo. Créalo como producto
            nuevo:
          </p>
          <label>
            Nombre
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} required />
          </label>
          <label>
            Categoría (opcional)
            <input value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} />
          </label>
          <div className="report-row">
            <button type="submit" className="btn btn-primary">
              Crear producto
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setNuevoBarra(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="report-row">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={catalogoOculto}
            onChange={(e) => setCatalogoOculto(e.target.checked)}
          />
          Ver catálogo oculto (productos sin activar)
        </label>
      </div>
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
                {catalogoOculto ? (
                  <button className="btn btn-primary btn-small" onClick={() => handleActivar(p)}>
                    Activar
                  </button>
                ) : (
                  <div className="table-controls">
                    <button className="btn btn-secondary btn-small" onClick={() => openEdit(p)}>
                      Editar
                    </button>
                    <button className="btn btn-danger btn-small" onClick={() => handleOcultar(p)}>
                      Desactivar
                    </button>
                  </div>
                )}
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
              <button className="btn btn-danger" onClick={() => handleOcultar()}>
                Ocultar producto
              </button>
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
