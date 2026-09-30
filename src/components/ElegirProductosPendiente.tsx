import { useCallback, useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { formatGramos, montoPorPeso } from '../lib/peso'
import { supabase } from '../lib/supabase'
import { Stepper } from './Stepper'
import { loadCatalogoTienda, productoFotoUrl, type ProductoTienda } from '../lib/tienda'
import type { ItemFiadoInput } from '../lib/pendientes'

export interface LineaFiado {
  producto: ProductoTienda
  /** Unidades, gramos si el producto es por peso, o packs si esCombo. */
  cantidad: number
  esCombo?: boolean
}

export function totalLineaFiado(l: LineaFiado): number {
  if (l.producto.por_peso) return montoPorPeso(l.producto.precio, l.cantidad)
  if (l.esCombo) return l.cantidad * (l.producto.combo_precio ?? 0)
  return l.producto.precio * l.cantidad
}

export function lineasATextoResumen(lineas: LineaFiado[]): string {
  return lineas
    .map((l) => (l.producto.por_peso ? `${l.producto.nombre} (${l.cantidad}g)` : `${l.cantidad}x ${l.producto.nombre}`))
    .join(', ')
}

export function lineasAItems(lineas: LineaFiado[]): ItemFiadoInput[] {
  return lineas.map((l) =>
    l.producto.por_peso
      ? { producto_id: l.producto.id, gramos: l.cantidad }
      : { producto_id: l.producto.id, cantidad: l.cantidad, es_combo: l.esCombo || undefined },
  )
}

const MAX_VISIBLES = 40

interface Props {
  inicial: LineaFiado[]
  onConfirmar: (lineas: LineaFiado[]) => void
  onCancelar: () => void
}

/** Elegir uno o varios productos para un fiado: descuenta el stock y calcula el monto solo. */
export function ElegirProductosPendiente({ inicial, onConfirmar, onCancelar }: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cargando, setCargando] = useState(false)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState(false)
  const [lineas, setLineas] = useState<LineaFiado[]>(inicial)
  const [pesoDe, setPesoDe] = useState<ProductoTienda | null>(null)
  const [gramos, setGramos] = useState('250')
  // El catalogo de la tienda no trae el stock real en gramos de los productos por peso (el cliente pide
  // aproximado); para elegir un fiado si hace falta el stock exacto, se consulta aparte.
  const [stockPeso, setStockPeso] = useState<Record<string, number>>({})

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const cargarProductos = useCallback(() => {
    setCargando(true)
    loadCatalogoTienda({ search: busqueda.trim() || undefined })
      .then(async (r) => {
        setProductos(r)
        setVerTodos(false)
        setErrorCarga(null)
        const idsPorPeso = r.filter((p) => p.por_peso).map((p) => p.id)
        if (idsPorPeso.length > 0) {
          const { data } = await supabase.from('ingreso_productos').select('id, stock').in('id', idsPorPeso)
          const mapa: Record<string, number> = {}
          for (const row of (data as { id: string; stock: number }[]) ?? []) mapa[row.id] = row.stock
          setStockPeso((prev) => ({ ...prev, ...mapa }))
        }
      })
      .catch((err) => setErrorCarga(err instanceof Error ? err.message : 'No se pudieron cargar los productos'))
      .finally(() => setCargando(false))
  }, [busqueda])

  useEffect(() => {
    const t = setTimeout(cargarProductos, 250)
    return () => clearTimeout(t)
  }, [cargarProductos])

  function agregar(p: ProductoTienda) {
    if (!p.disponible) return
    if (p.por_peso) {
      setPesoDe(p)
      setGramos('250')
      return
    }
    setLineas((prev) => {
      const ex = prev.find((l) => l.producto.id === p.id && !l.esCombo)
      const max = p.stock_max ?? Infinity
      if (ex) return prev.map((l) => (l.producto.id === p.id && !l.esCombo ? { ...l, cantidad: Math.min(max, l.cantidad + 1) } : l))
      return [...prev, { producto: p, cantidad: 1 }]
    })
  }

  function agregarPack(p: ProductoTienda) {
    if (!p.combo_cantidad || !p.combo_precio) return
    const maxPacks = Math.floor((p.stock_max ?? 0) / p.combo_cantidad)
    if (maxPacks <= 0) return
    setLineas((prev) => {
      const ex = prev.find((l) => l.producto.id === p.id && l.esCombo)
      if (ex) return prev.map((l) => (l.producto.id === p.id && l.esCombo ? { ...l, cantidad: Math.min(maxPacks, l.cantidad + 1) } : l))
      return [...prev, { producto: p, cantidad: 1, esCombo: true }]
    })
  }

  function confirmarPeso() {
    if (!pesoDe) return
    const g = Math.round(Number(gramos))
    if (!g || g < 50) return
    setLineas((prev) => [...prev.filter((l) => l.producto.id !== pesoDe.id), { producto: pesoDe, cantidad: g }])
    setPesoDe(null)
  }

  function cambiar(id: string, esCombo: boolean | undefined, cantidad: number) {
    setLineas((prev) =>
      cantidad <= 0
        ? prev.filter((l) => !(l.producto.id === id && !!l.esCombo === !!esCombo))
        : prev.map((l) => (l.producto.id === id && !!l.esCombo === !!esCombo ? { ...l, cantidad } : l)),
    )
  }

  const enLinea = (id: string) => lineas.filter((l) => l.producto.id === id).reduce((sum, l) => sum + l.cantidad, 0)
  const total = lineas.reduce((sum, l) => sum + totalLineaFiado(l), 0)
  const visibles = verTodos ? productos : productos.slice(0, MAX_VISIBLES)

  return (
    <div className="camera-overlay">
      <div className="camera-modal manual-modal">
        <div className="modal-top">
          <button type="button" className="btn btn-secondary btn-small" onClick={onCancelar}>
            ← Cancelar
          </button>
          <h2>Elegir productos</h2>
        </div>
        <p className="subtitle">Esto descuenta el stock de una vez, aunque el cliente todavía no pague.</p>

        <input
          type="search"
          className="manual-buscar"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar producto por nombre"
          autoFocus
        />

        {pesoDe && (
          <div className="manual-peso">
            <strong>{pesoDe.nombre}</strong> · {formatCLP(pesoDe.precio)}/kg
            {stockPeso[pesoDe.id] !== undefined && (
              <p className="subtitle">Stock disponible: {formatGramos(stockPeso[pesoDe.id])}</p>
            )}
            <div className="report-row">
              <input
                type="number"
                min={50}
                max={stockPeso[pesoDe.id]}
                value={gramos}
                onChange={(e) => setGramos(e.target.value)}
                className="qty-input"
                autoFocus
              />
              <span>gramos</span>
              <button type="button" className="btn btn-primary btn-small" onClick={confirmarPeso}>
                Agregar
              </button>
              <button type="button" className="btn-link" onClick={() => setPesoDe(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {errorCarga && <p className="error-text">{errorCarga}</p>}
        <div className="manual-catalogo">
          {visibles.map((p) => {
            const n = enLinea(p.id)
            return (
              <div key={p.id} className={p.disponible ? 'manual-prod' : 'manual-prod agotado'}>
                <button type="button" className="manual-prod-click" disabled={!p.disponible} onClick={() => agregar(p)}>
                  {p.foto_path ? (
                    <img src={productoFotoUrl(p.foto_path)} alt="" className="manual-foto" loading="lazy" />
                  ) : (
                    <span className="manual-foto manual-foto-vacia">🛒</span>
                  )}
                  <span className="manual-prod-info">
                    <span className="manual-prod-nombre">{p.nombre}</span>
                    <span className="manual-prod-precio">
                      {formatCLP(p.precio)}
                      {p.por_peso ? '/kg' : ''}
                      {!p.disponible
                        ? ' · Sin stock'
                        : p.por_peso
                          ? stockPeso[p.id] !== undefined
                            ? ` · stock ${formatGramos(stockPeso[p.id])}`
                            : ''
                          : p.stock_max !== null
                            ? ` · stock ${p.stock_max}`
                            : ''}
                    </span>
                  </span>
                </button>
                {p.combo_cantidad && p.combo_precio && (
                  <button
                    type="button"
                    className="manual-pack-btn"
                    disabled={!p.combo_disponible}
                    onClick={() => agregarPack(p)}
                  >
                    + Pack {p.combo_cantidad} × {formatCLP(p.combo_precio)}
                  </button>
                )}
                {n > 0 && p.por_peso && <span className="manual-en-pedido">{n}g</span>}
                {n > 0 && !p.por_peso && (
                  <div className="manual-prod-stepper">
                    <Stepper
                      value={n}
                      min={0}
                      max={p.stock_max}
                      onChange={(v) => cambiar(p.id, false, v)}
                    />
                  </div>
                )}
              </div>
            )
          })}
          {cargando && productos.length === 0 && <p className="subtitle">Cargando productos...</p>}
          {!cargando && !errorCarga && productos.length === 0 && <p className="subtitle">Sin resultados.</p>}
        </div>
        {!verTodos && productos.length > MAX_VISIBLES && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setVerTodos(true)}>
            Ver los {productos.length - MAX_VISIBLES} productos restantes
          </button>
        )}

        <h3 className="manual-titulo">Lo que se lleva ({lineas.length})</h3>
        {lineas.length === 0 && <p className="subtitle">Toca un producto para agregarlo.</p>}
        <div className="carrito-lista">
          {lineas.map((l) => (
            <div key={`${l.producto.id}-${l.esCombo ? 'pack' : 'un'}`} className="carrito-item">
              <button
                type="button"
                className="carrito-quitar"
                aria-label={`Quitar ${l.producto.nombre}`}
                onClick={() => cambiar(l.producto.id, l.esCombo, 0)}
              >
                ✕
              </button>
              {l.producto.foto_path ? (
                <img src={productoFotoUrl(l.producto.foto_path)} alt="" className="carrito-foto" />
              ) : (
                <div className="carrito-foto carrito-foto-vacia">🛒</div>
              )}
              <div className="carrito-info">
                <p className="carrito-nombre">
                  {l.producto.nombre}
                  {l.esCombo && ` · pack x${l.producto.combo_cantidad}`}
                </p>
                <p className="carrito-precio">{formatCLP(totalLineaFiado(l))}</p>
                <div className="carrito-acciones">
                  {l.producto.por_peso ? (
                    <span>{l.cantidad} g</span>
                  ) : l.esCombo ? (
                    <Stepper
                      value={l.cantidad}
                      min={1}
                      max={Math.floor((l.producto.stock_max ?? 0) / (l.producto.combo_cantidad ?? 1))}
                      label={`${l.cantidad} pack(s)`}
                      onChange={(v) => cambiar(l.producto.id, true, v)}
                    />
                  ) : (
                    <Stepper
                      value={l.cantidad}
                      min={1}
                      max={l.producto.stock_max}
                      onChange={(v) => cambiar(l.producto.id, false, v)}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="manual-pie">
          <p>
            Total: <strong>{formatCLP(total)}</strong>
          </p>
          <div className="report-row">
            <button type="button" className="btn btn-secondary btn-small" onClick={onCancelar}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={lineas.length === 0}
              onClick={() => onConfirmar(lineas)}
            >
              Listo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
