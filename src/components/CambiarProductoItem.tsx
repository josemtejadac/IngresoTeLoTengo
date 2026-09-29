import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { cambiarProductoItem, loadCatalogoTienda, type ProductoTienda } from '../lib/tienda'

interface Props {
  itemId: string
  onCambiado: () => void
}

const MAX_RESULTADOS = 8

/** El personal cambia un producto ya pedido por otro (ej. el cliente pidio Coca Zero y queria Original). */
export function CambiarProductoItem({ itemId, onCambiado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cargando, setCargando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    setCargando(true)
    const t = setTimeout(() => {
      loadCatalogoTienda({ search: busqueda.trim() || undefined })
        .then((r) => setProductos(r.filter((p) => p.disponible && !p.por_peso).slice(0, MAX_RESULTADOS)))
        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los productos'))
        .finally(() => setCargando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [abierto, busqueda])

  async function cambiar(p: ProductoTienda) {
    setBusy(true)
    setError(null)
    try {
      await cambiarProductoItem(itemId, p.id)
      setAbierto(false)
      setBusqueda('')
      onCambiado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el producto')
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="chip-accion chip-cambiar" onClick={() => setAbierto(true)}>
        🔁 Cambiar
      </button>
    )
  }

  return (
    <div className="agregar-item-pedido">
      <div className="report-row">
        <input
          type="search"
          className="manual-buscar"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar el producto de reemplazo"
          autoFocus
        />
        <button type="button" className="btn-link" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {cargando && <p className="subtitle">Buscando...</p>}
      {!cargando && busqueda.trim() && productos.length === 0 && (
        <p className="subtitle">Sin resultados disponibles.</p>
      )}
      <div className="agregar-item-lista">
        {productos.map((p) => (
          <div key={p.id} className="agregar-item-fila">
            <span className="agregar-item-nombre">
              {p.nombre} · {formatCLP(p.precio)}
            </span>
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => cambiar(p)}>
              {busy ? '...' : 'Usar este'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
