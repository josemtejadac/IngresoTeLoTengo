import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { loadProductos, type Producto } from '../lib/inventario'

export interface ItemPromo {
  producto_id: string
  nombre: string
  precio: number | null
  cantidad: number
}

interface Props {
  items: ItemPromo[]
  onChange: (items: ItemPromo[]) => void
}

const MAX_RESULTADOS = 8

/** Elegir los productos (y cuantos de cada uno) que lleva una promo. */
export function ElegirProductosPromo({ items, onChange }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<Producto[]>([])

  useEffect(() => {
    const term = busqueda.trim()
    if (!term) {
      setResultados([])
      return
    }
    const t = setTimeout(() => {
      loadProductos({ search: term, limit: 30 })
        .then((rows) =>
          setResultados(
            rows
              .filter((p) => !p.es_promo && !p.por_peso && !items.some((i) => i.producto_id === p.id))
              .slice(0, MAX_RESULTADOS),
          ),
        )
        .catch(() => setResultados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda, items])

  function agregar(p: Producto) {
    onChange([...items, { producto_id: p.id, nombre: p.nombre, precio: p.precio, cantidad: 1 }])
    setBusqueda('')
  }

  function cambiarCantidad(productoId: string, valor: string) {
    const cantidad = Math.max(1, Math.round(Number(valor) || 1))
    onChange(items.map((i) => (i.producto_id === productoId ? { ...i, cantidad } : i)))
  }

  const precioSeparado = items.reduce((sum, i) => sum + (i.precio ?? 0) * i.cantidad, 0)

  return (
    <div className="agregar-item-pedido">
      <p className="subtitle">Productos de la promo (al venderla se descuentan del stock de cada uno):</p>
      {items.length > 0 && (
        <div className="agregar-item-lista">
          {items.map((i) => (
            <div key={i.producto_id} className="agregar-item-fila">
              <span className="agregar-item-nombre">{i.nombre}</span>
              <input
                type="number"
                min={1}
                className="qty-input"
                value={i.cantidad}
                onChange={(e) => cambiarCantidad(i.producto_id, e.target.value)}
              />
              <button
                type="button"
                className="btn-link"
                onClick={() => onChange(items.filter((x) => x.producto_id !== i.producto_id))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        type="search"
        className="manual-buscar"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
        placeholder="🔍 Buscar producto para agregar (ej. harina)"
      />
      {resultados.length > 0 && (
        <div className="agregar-item-lista">
          {resultados.map((p) => (
            <div key={p.id} className="agregar-item-fila">
              <span className="agregar-item-nombre">
                {p.nombre} · {p.precio !== null ? formatCLP(p.precio) : 'sin precio'} · stock {p.stock}
              </span>
              <button type="button" className="btn btn-primary btn-small" onClick={() => agregar(p)}>
                Agregar
              </button>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && precioSeparado > 0 && (
        <p className="subtitle">Por separado costarían {formatCLP(precioSeparado)}.</p>
      )}
    </div>
  )
}
