import { useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { montoPorPeso } from '../lib/peso'
import { Stepper } from './Stepper'
import { crearPedidoTienda, loadCatalogoTienda, type ProductoTienda } from '../lib/tienda'

interface Linea {
  producto: ProductoTienda
  /** Unidades, o gramos si el producto es por peso. */
  cantidad: number
}

function totalLinea(l: Linea): number {
  return l.producto.por_peso ? montoPorPeso(l.producto.precio, l.cantidad) : l.producto.precio * l.cantidad
}

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
  const [resultados, setResultados] = useState<ProductoTienda[]>([])
  const [lineas, setLineas] = useState<Linea[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([])
      return
    }
    let vivo = true
    const t = setTimeout(() => {
      loadCatalogoTienda({ search: busqueda.trim() })
        .then((r) => vivo && setResultados(r.slice(0, 8)))
        .catch(() => vivo && setResultados([]))
    }, 250)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [busqueda])

  function agregar(p: ProductoTienda) {
    if (!p.disponible) return
    if (p.por_peso) {
      const g = Math.round(Number(window.prompt(`¿Cuántos gramos de ${p.nombre}?`, '250')))
      if (!g || g < 50) return
      setLineas((prev) => [...prev.filter((l) => l.producto.id !== p.id), { producto: p, cantidad: g }])
    } else {
      setLineas((prev) => {
        const ex = prev.find((l) => l.producto.id === p.id)
        const max = p.stock_max ?? Infinity
        if (ex) return prev.map((l) => (l.producto.id === p.id ? { ...l, cantidad: Math.min(max, l.cantidad + 1) } : l))
        return [...prev, { producto: p, cantidad: 1 }]
      })
    }
    setBusqueda('')
    setResultados([])
  }

  function cambiar(id: string, cantidad: number) {
    setLineas((prev) => (cantidad <= 0 ? prev.filter((l) => l.producto.id !== id) : prev.map((l) => (l.producto.id === id ? { ...l, cantidad } : l))))
  }

  const total = lineas.reduce((sum, l) => sum + totalLinea(l), 0)

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
      setAbierto(false)
      onCreado()
    } catch (err) {
      const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : 'Error creando el pedido'
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

  return (
    <form className="pedido-manual worker-form" onSubmit={guardar}>
      <h3>Pedido manual</h3>
      <div className="pedido-manual-datos">
        <label>
          Nombre
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        </label>
        <label>
          Teléfono
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} required />
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

      <label>
        Buscar producto
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Nombre del producto"
        />
      </label>
      {resultados.length > 0 && (
        <div className="manual-resultados">
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              className="manual-resultado"
              disabled={!p.disponible}
              onClick={() => agregar(p)}
            >
              <span>{p.nombre}</span>
              <span>
                {p.disponible ? formatCLP(p.precio) + (p.por_peso ? '/kg' : '') : 'Sin stock'}
              </span>
            </button>
          ))}
        </div>
      )}

      {lineas.map((l) => (
        <div key={l.producto.id} className="manual-linea">
          <span className="manual-linea-nombre">{l.producto.nombre}</span>
          {l.producto.por_peso ? (
            <span>{l.cantidad} g</span>
          ) : (
            <Stepper value={l.cantidad} min={1} max={l.producto.stock_max} onChange={(v) => cambiar(l.producto.id, v)} />
          )}
          <strong>{formatCLP(totalLinea(l))}</strong>
          <button type="button" className="carrito-quitar manual-quitar" aria-label="Quitar" onClick={() => cambiar(l.producto.id, 0)}>
            ✕
          </button>
        </div>
      ))}

      <p>
        Total: <strong>{formatCLP(total)}</strong>
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="report-row">
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          {busy ? 'Guardando...' : 'Crear pedido'}
        </button>
      </div>
    </form>
  )
}
