import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { BAJO_STOCK_LIMITE, loadProductos, productoFotoUrl, type Producto } from '../lib/inventario'
import { Stepper } from './Stepper'

export interface ItemPromo {
  producto_id: string
  nombre: string
  precio: number | null
  stock: number
  foto_path: string | null
  cantidad: number
}

interface Props {
  items: ItemPromo[]
  onChange: (items: ItemPromo[]) => void
  /** Precio que se esta poniendo a la promo (0 = aun sin precio), para mostrar cuanto ahorra el cliente. */
  precioPromo: number
}

const MAX_RESULTADOS = 8

function Miniatura({ fotoPath }: { fotoPath: string | null }) {
  return fotoPath ? (
    <img src={productoFotoUrl(fotoPath)} alt="" className="promo-thumb" loading="lazy" />
  ) : (
    <span className="promo-thumb promo-thumb-vacia">🛒</span>
  )
}

function ChipStock({ stock }: { stock: number }) {
  const clase = stock <= 0 ? 'chip-stock sin' : stock <= BAJO_STOCK_LIMITE ? 'chip-stock bajo' : 'chip-stock'
  return <span className={clase}>{stock <= 0 ? 'Sin stock' : `Stock ${stock}`}</span>
}

/** Elegir los productos (y cuantos de cada uno) que lleva una promo. */
export function ElegirProductosPromo({ items, onChange, precioPromo }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<Producto[]>([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    const term = busqueda.trim()
    if (!term) {
      setResultados([])
      setBuscando(false)
      return
    }
    setBuscando(true)
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
        .finally(() => setBuscando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [busqueda, items])

  function agregar(p: Producto) {
    onChange([
      ...items,
      { producto_id: p.id, nombre: p.nombre, precio: p.precio, stock: p.stock, foto_path: p.foto_path, cantidad: 1 },
    ])
    setBusqueda('')
  }

  function cambiarCantidad(productoId: string, cantidad: number) {
    onChange(items.map((i) => (i.producto_id === productoId ? { ...i, cantidad } : i)))
  }

  const precioSeparado = items.reduce((sum, i) => sum + (i.precio ?? 0) * i.cantidad, 0)
  const ahorro = precioPromo > 0 ? precioSeparado - precioPromo : 0
  const alcanza = items.length > 0 ? Math.min(...items.map((i) => Math.max(0, Math.floor(i.stock / i.cantidad)))) : 0

  return (
    <div className="promo-builder">
      <div className="promo-builder-head">
        <span className="promo-builder-titulo">Productos de la promo</span>
        {items.length > 0 && <span className="subtitle">{items.length} elegido{items.length === 1 ? '' : 's'}</span>}
      </div>

      {items.length === 0 ? (
        <p className="promo-vacio">
          Busca y agrega al menos 2 productos. Cuando se venda la promo, se descuentan solos del stock de cada uno.
        </p>
      ) : (
        <ul className="promo-items">
          {items.map((i) => (
            <li key={i.producto_id} className="promo-item">
              <Miniatura fotoPath={i.foto_path} />
              <div className="promo-item-info">
                <span className="promo-item-nombre">{i.nombre}</span>
                <span className="promo-item-meta">
                  {i.precio !== null ? `${formatCLP(i.precio)} c/u` : 'Sin precio'} <ChipStock stock={i.stock} />
                </span>
              </div>
              <Stepper value={i.cantidad} onChange={(n) => cambiarCantidad(i.producto_id, n)} min={1} max={99} />
              <button
                type="button"
                className="promo-item-quitar"
                aria-label={`Quitar ${i.nombre}`}
                onClick={() => onChange(items.filter((x) => x.producto_id !== i.producto_id))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="promo-buscar">
        <span aria-hidden="true">🔍</span>
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={items.length === 0 ? 'Buscar producto (ej. harina)' : 'Agregar otro producto'}
          enterKeyHint="search"
        />
      </div>

      {buscando && resultados.length === 0 && <p className="subtitle promo-estado">Buscando...</p>}
      {!buscando && busqueda.trim() !== '' && resultados.length === 0 && (
        <p className="subtitle promo-estado">No hay productos con ese nombre.</p>
      )}
      {resultados.length > 0 && (
        <ul className="promo-resultados">
          {resultados.map((p) => (
            <li key={p.id}>
              <button type="button" className="promo-resultado" onClick={() => agregar(p)}>
                <Miniatura fotoPath={p.foto_path} />
                <span className="promo-item-info">
                  <span className="promo-item-nombre">{p.nombre}</span>
                  <span className="promo-item-meta">
                    {p.precio !== null ? formatCLP(p.precio) : 'Sin precio'} <ChipStock stock={p.stock} />
                  </span>
                </span>
                <span className="promo-resultado-mas" aria-hidden="true">
                  +
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <div className="promo-resumen">
          {precioSeparado > 0 && (
            <div className="promo-resumen-fila">
              <span>Comprando por separado</span>
              <strong>{formatCLP(precioSeparado)}</strong>
            </div>
          )}
          {precioPromo > 0 && (
            <div className="promo-resumen-fila">
              <span>Precio de la promo</span>
              <strong>{formatCLP(precioPromo)}</strong>
            </div>
          )}
          {ahorro > 0 && precioSeparado > 0 && (
            <div className="promo-resumen-fila promo-ahorro">
              <span>El cliente ahorra</span>
              <strong>
                {formatCLP(ahorro)} ({Math.round((ahorro / precioSeparado) * 100)}%)
              </strong>
            </div>
          )}
          {ahorro < 0 && <p className="promo-aviso">⚠️ La promo sale más cara que comprar los productos por separado.</p>}
          <div className="promo-resumen-fila">
            <span>Alcanza para</span>
            <strong className={alcanza === 0 ? 'promo-alcanza-cero' : undefined}>
              {alcanza} promo{alcanza === 1 ? '' : 's'}
            </strong>
          </div>
        </div>
      )}
    </div>
  )
}
