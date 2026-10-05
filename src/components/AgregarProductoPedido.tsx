import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { agregarItemPedido, agregarItemPesoPedido, loadCatalogoTienda, type ProductoTienda } from '../lib/tienda'

interface Props {
  pedidoId: string
  onAgregado: () => void
}

const MAX_RESULTADOS = 8

/** El personal agrega un producto extra a un pedido ya hecho (ej. el cliente pidio algo mas por otro medio). */
export function AgregarProductoPedido({ pedidoId, onAgregado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cargando, setCargando] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [agregado, setAgregado] = useState<string | null>(null)
  const [gramosPorId, setGramosPorId] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!abierto) return
    setCargando(true)
    const t = setTimeout(() => {
      loadCatalogoTienda({ search: busqueda.trim() || undefined })
        .then((r) => setProductos(r.filter((p) => p.disponible).slice(0, MAX_RESULTADOS)))
        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los productos'))
        .finally(() => setCargando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [abierto, busqueda])

  async function agregar(p: ProductoTienda, esCombo: boolean) {
    setBusyId(p.id)
    setError(null)
    setAgregado(null)
    try {
      if (p.por_peso) {
        const gramos = Math.round(Number(gramosPorId[p.id] ?? 250))
        await agregarItemPesoPedido(pedidoId, p.id, gramos)
      } else {
        await agregarItemPedido(pedidoId, p.id, 1, esCombo)
      }
      setAgregado(p.nombre)
      onAgregado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo agregar el producto')
    } finally {
      setBusyId(null)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(true)}>
        + Agregar producto
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
          placeholder="🔍 Buscar producto por nombre"
          autoFocus
        />
        <button type="button" className="btn-link" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
      {agregado && <p className="subtitle">✓ {agregado} agregado al pedido.</p>}
      {cargando && <p className="subtitle">Buscando...</p>}
      {!cargando && busqueda.trim() && productos.length === 0 && (
        <p className="subtitle">Sin resultados disponibles.</p>
      )}
      <div className="agregar-item-lista">
        {productos.map((p) => (
          <div key={p.id} className="agregar-item-fila">
            <span className="agregar-item-nombre">
              {p.nombre} · {formatCLP(p.precio)}
              {p.por_peso ? ' /kg' : ''}
            </span>
            {p.por_peso && (
              <input
                type="number"
                min={50}
                step={50}
                className="agregar-item-gramos"
                value={gramosPorId[p.id] ?? '250'}
                onChange={(e) => setGramosPorId((prev) => ({ ...prev, [p.id]: e.target.value }))}
                aria-label="Gramos"
                title="Gramos a agregar"
              />
            )}
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={busyId === p.id}
              onClick={() => agregar(p, false)}
            >
              {busyId === p.id ? '...' : '+ Agregar'}
            </button>
            {!p.por_peso && p.combo_cantidad && p.combo_precio && (
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={busyId === p.id || !p.combo_disponible}
                onClick={() => agregar(p, true)}
              >
                + Pack {p.combo_cantidad} × {formatCLP(p.combo_precio)}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
