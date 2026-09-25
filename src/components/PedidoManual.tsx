import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { montoPorPeso } from '../lib/peso'
import { Stepper } from './Stepper'
import {
  crearPedidoTienda,
  loadCatalogoTienda,
  loadCategoriasTienda,
  productoFotoUrl,
  type ProductoTienda,
} from '../lib/tienda'

interface Linea {
  producto: ProductoTienda
  /** Unidades, o gramos si el producto es por peso. */
  cantidad: number
}

function totalLinea(l: Linea): number {
  return l.producto.por_peso ? montoPorPeso(l.producto.precio, l.cantidad) : l.producto.precio * l.cantidad
}

const MAX_VISIBLES = 40

interface Props {
  onCreado: () => void
}

/** Pedido manual: el trabajador anota un pedido que llego por otro medio (contra entrega). */
export function PedidoManual({ onCreado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [torre, setTorre] = useState('')
  const [depto, setDepto] = useState('')
  const [metodo, setMetodo] = useState<'efectivo' | 'tarjeta'>('efectivo')
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [categorias, setCategorias] = useState<string[]>([])
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [verTodos, setVerTodos] = useState(false)
  const [lineas, setLineas] = useState<Linea[]>([])
  const [pesoDe, setPesoDe] = useState<ProductoTienda | null>(null)
  const [gramos, setGramos] = useState('250')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Con la ventana abierta, la pagina de atras no se mueve.
  useEffect(() => {
    if (!abierto) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [abierto])

  useEffect(() => {
    if (abierto && categorias.length === 0) loadCategoriasTienda().then(setCategorias).catch(() => {})
  }, [abierto, categorias.length])

  useEffect(() => {
    if (!abierto) return
    let vivo = true
    const t = setTimeout(() => {
      loadCatalogoTienda({ search: busqueda.trim() || undefined, categoria: categoria || undefined })
        .then((r) => {
          if (!vivo) return
          setProductos(r)
          setVerTodos(false)
        })
        .catch(() => vivo && setProductos([]))
    }, 250)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [abierto, busqueda, categoria])

  function agregar(p: ProductoTienda) {
    if (!p.disponible) return
    if (p.por_peso) {
      setPesoDe(p)
      setGramos('250')
      return
    }
    setLineas((prev) => {
      const ex = prev.find((l) => l.producto.id === p.id)
      const max = p.stock_max ?? Infinity
      if (ex) return prev.map((l) => (l.producto.id === p.id ? { ...l, cantidad: Math.min(max, l.cantidad + 1) } : l))
      return [...prev, { producto: p, cantidad: 1 }]
    })
  }

  function confirmarPeso() {
    if (!pesoDe) return
    const g = Math.round(Number(gramos))
    if (!g || g < 50) return
    setLineas((prev) => [...prev.filter((l) => l.producto.id !== pesoDe.id), { producto: pesoDe, cantidad: g }])
    setPesoDe(null)
  }

  function cambiar(id: string, cantidad: number) {
    setLineas((prev) =>
      cantidad <= 0 ? prev.filter((l) => l.producto.id !== id) : prev.map((l) => (l.producto.id === id ? { ...l, cantidad } : l)),
    )
  }

  const total = lineas.reduce((sum, l) => sum + totalLinea(l), 0)
  const enLinea = (id: string) => lineas.find((l) => l.producto.id === id)?.cantidad ?? 0

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (lineas.length === 0) {
      setError('Agrega al menos un producto.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await crearPedidoTienda({
        nombre,
        telefono,
        torre,
        depto,
        metodo,
        items: lineas.map((l) =>
          l.producto.por_peso
            ? { producto_id: l.producto.id, gramos: l.cantidad }
            : { producto_id: l.producto.id, cantidad: l.cantidad },
        ),
      })
      setNombre('')
      setTelefono('')
      setTorre('')
      setDepto('')
      setMetodo('efectivo')
      setLineas([])
      setBusqueda('')
      setCategoria('')
      setAbierto(false)
      onCreado()
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'Error creando el pedido'
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button className="btn btn-primary btn-small" onClick={() => setAbierto(true)}>
        + Pedido manual
      </button>
    )
  }

  const visibles = verTodos ? productos : productos.slice(0, MAX_VISIBLES)

  return (
    <div className="camera-overlay">
      <form className="camera-modal manual-modal" onSubmit={guardar}>
        <div className="modal-top">
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(false)}>
            ← Cerrar
          </button>
          <h2>Pedido manual</h2>
        </div>
        <p className="subtitle">
          Para pedidos que llegan por otro medio (WhatsApp, en persona). El cliente paga al recibir.
        </p>

        <div className="manual-datos">
          <label>
            Nombre
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </label>
          <label>
            Teléfono
            <input value={telefono} onChange={(e) => setTelefono(e.target.value)} inputMode="tel" required />
          </label>
          <label>
            Torre
            <input value={torre} onChange={(e) => setTorre(e.target.value)} required />
          </label>
          <label>
            Depto
            <input value={depto} onChange={(e) => setDepto(e.target.value)} required />
          </label>
        </div>

        <fieldset className="pago-metodos">
          <legend>Paga en la entrega con</legend>
          {(['efectivo', 'tarjeta'] as const).map((m) => (
            <label key={m} className="checkbox-label">
              <input type="radio" name="metodo-manual" checked={metodo === m} onChange={() => setMetodo(m)} />
              {m === 'efectivo' ? 'Efectivo' : 'Tarjeta'}
            </label>
          ))}
        </fieldset>

        <h3 className="manual-titulo">Productos</h3>
        <input
          type="search"
          className="manual-buscar"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="🔍 Buscar producto por nombre"
        />
        <div className="tienda-chips">
          <button
            type="button"
            className={categoria === '' ? 'tienda-chip activo' : 'tienda-chip'}
            onClick={() => setCategoria('')}
          >
            Todas
          </button>
          {categorias.map((c) => (
            <button
              key={c}
              type="button"
              className={categoria === c ? 'tienda-chip activo' : 'tienda-chip'}
              onClick={() => setCategoria(c)}
            >
              {c.replace(/\s+/g, ' ').trim()}
            </button>
          ))}
        </div>

        {pesoDe && (
          <div className="manual-peso">
            <strong>{pesoDe.nombre}</strong> · {formatCLP(pesoDe.precio)}/kg
            <div className="report-row">
              <input
                type="number"
                min={50}
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

        <div className="manual-catalogo">
          {visibles.map((p) => {
            const n = enLinea(p.id)
            return (
              <button
                key={p.id}
                type="button"
                className={p.disponible ? 'manual-prod' : 'manual-prod agotado'}
                disabled={!p.disponible}
                onClick={() => agregar(p)}
              >
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
                    {!p.disponible ? ' · Sin stock' : p.stock_max !== null ? ` · stock ${p.stock_max}` : ''}
                  </span>
                </span>
                {n > 0 && <span className="manual-en-pedido">{p.por_peso ? `${n}g` : `×${n}`}</span>}
              </button>
            )
          })}
          {productos.length === 0 && <p className="subtitle">No hay productos con esa búsqueda.</p>}
        </div>
        {!verTodos && productos.length > MAX_VISIBLES && (
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setVerTodos(true)}>
            Ver los {productos.length - MAX_VISIBLES} productos restantes
          </button>
        )}

        <h3 className="manual-titulo">Pedido ({lineas.length})</h3>
        {lineas.length === 0 && <p className="subtitle">Toca un producto para agregarlo.</p>}
        <div className="carrito-lista">
          {lineas.map((l) => (
            <div key={l.producto.id} className="carrito-item">
              <button
                type="button"
                className="carrito-quitar"
                aria-label={`Quitar ${l.producto.nombre}`}
                onClick={() => cambiar(l.producto.id, 0)}
              >
                ✕
              </button>
              {l.producto.foto_path ? (
                <img src={productoFotoUrl(l.producto.foto_path)} alt="" className="carrito-foto" />
              ) : (
                <div className="carrito-foto carrito-foto-vacia">🛒</div>
              )}
              <div className="carrito-info">
                <p className="carrito-nombre">{l.producto.nombre}</p>
                <p className="carrito-precio">{formatCLP(totalLinea(l))}</p>
                <div className="carrito-acciones">
                  {l.producto.por_peso ? (
                    <span>{l.cantidad} g</span>
                  ) : (
                    <Stepper
                      value={l.cantidad}
                      min={1}
                      max={l.producto.stock_max}
                      onChange={(v) => cambiar(l.producto.id, v)}
                    />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="manual-pie">
          <p>
            Total: <strong>{formatCLP(total)}</strong> · {metodo === 'efectivo' ? 'Efectivo' : 'Tarjeta'} al entregar
          </p>
          {error && <p className="error-text">{error}</p>}
          <div className="report-row">
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || lineas.length === 0}>
              {busy ? 'Guardando...' : 'Crear pedido'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
