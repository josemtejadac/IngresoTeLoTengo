import { useCallback, useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import { loadProductos, type Producto } from '../lib/inventario'
import { loadMermasHistorial, registrarMerma, type MermaHistorial, type TipoMerma } from '../lib/tienda'

const COPY: Record<
  TipoMerma,
  {
    boton: string
    titulo: string
    intro: string
    cantidadLabel: string
    motivoLabel: string
    motivoPlaceholder: string
    agregarTexto: string
    guardarTexto: string
    okTexto: string
    vacioTexto: string
  }
> = {
  merma: {
    boton: '🗑️ Merma',
    titulo: 'Registrar merma',
    intro:
      'Para productos que se perdieron, se echaron a perder o se rompieron. Descuenta el stock y queda guardado con fecha y quién lo registró.',
    cantidadLabel: 'perdida',
    motivoLabel: 'Motivo (opcional)',
    motivoPlaceholder: 'Ej: se echó a perder, se cayó...',
    agregarTexto: 'Agregar a la lista',
    guardarTexto: 'Guardar',
    okTexto: 'Mermas guardadas',
    vacioTexto: 'Sin mermas registradas.',
  },
  gasto_operativo: {
    boton: '📦 Gasto operativo',
    titulo: 'Registrar gasto operativo',
    intro:
      'Para cuando se agarran productos de la tienda para uso de la tienda (ej. bolsas, limpieza). Descuenta el stock y queda guardado con fecha, motivo y quién lo registró.',
    cantidadLabel: 'usada',
    motivoLabel: 'Motivo',
    motivoPlaceholder: 'Ej: bolsas para embalar pedidos',
    agregarTexto: 'Agregar a la lista',
    guardarTexto: 'Guardar',
    okTexto: 'Gastos guardados',
    vacioTexto: 'Sin gastos operativos registrados.',
  },
}

interface Props {
  tipo: TipoMerma
}

interface ItemCarrito {
  key: string
  producto: Producto
  cantidad: string
  nota: string
}

const HOY_TEXTO = 'Hoy'
const AYER_TEXTO = 'Ayer'

/** Agrupa el historial por dia (mas reciente primero), con un titulo legible para cada grupo. */
function gruposHistorialPorFecha(historial: MermaHistorial[]): { fecha: string; fechaTexto: string; filas: MermaHistorial[] }[] {
  const hoy = new Date().toDateString()
  const ayer = new Date(Date.now() - 86400000).toDateString()
  const mapa = new Map<string, MermaHistorial[]>()
  for (const m of historial) {
    const fecha = new Date(m.created_at).toDateString()
    mapa.set(fecha, [...(mapa.get(fecha) ?? []), m])
  }
  return [...mapa.entries()].map(([fecha, filas]) => ({
    fecha,
    fechaTexto:
      fecha === hoy
        ? HOY_TEXTO
        : fecha === ayer
          ? AYER_TEXTO
          : new Date(filas[0].created_at).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'short' }),
    filas,
  }))
}

/** El personal registra una o varias salidas de stock que no son venta: merma o gasto operativo. */
export function Merma({ tipo }: Props) {
  const c = COPY[tipo]
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<Producto[]>([])
  const [cargando, setCargando] = useState(false)
  const [elegido, setElegido] = useState<Producto | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [nota, setNota] = useState('')
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [historial, setHistorial] = useState<MermaHistorial[]>([])
  const [verHistorial, setVerHistorial] = useState(false)

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
    if (!abierto || elegido) return
    setCargando(true)
    const t = setTimeout(() => {
      loadProductos({ search: busqueda.trim() || undefined, limit: 8 })
        .then(setProductos)
        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los productos'))
        .finally(() => setCargando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [abierto, elegido, busqueda])

  const cargarHistorial = useCallback(() => {
    loadMermasHistorial(30, tipo)
      .then(setHistorial)
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el historial'))
  }, [tipo])

  useEffect(() => {
    if (verHistorial) cargarHistorial()
  }, [verHistorial, cargarHistorial])

  function elegir(p: Producto) {
    setElegido(p)
    setCantidad('')
    setNota('')
    setError(null)
    setOk(null)
  }

  function agregarAlCarrito() {
    if (!elegido) return
    const n = Number(cantidad)
    if (!n || n <= 0) {
      setError('Pon una cantidad válida.')
      return
    }
    if (tipo === 'gasto_operativo' && !nota.trim()) {
      setError('Pon el motivo.')
      return
    }
    setCarrito((prev) => [
      ...prev,
      { key: `${elegido.id}-${Date.now()}`, producto: elegido, cantidad: cantidad, nota: nota.trim() },
    ])
    setError(null)
    setElegido(null)
    setCantidad('')
    setNota('')
    setBusqueda('')
  }

  function quitarDelCarrito(key: string) {
    setCarrito((prev) => prev.filter((i) => i.key !== key))
  }

  async function guardarTodo() {
    if (carrito.length === 0) return
    setBusy(true)
    setError(null)
    setOk(null)
    const okKeys: string[] = []
    const fallidos: { nombre: string; motivo: string }[] = []
    for (const item of carrito) {
      try {
        await registrarMerma(item.producto.id, Number(item.cantidad), item.nota, tipo)
        okKeys.push(item.key)
      } catch (err) {
        fallidos.push({ nombre: item.producto.nombre, motivo: err instanceof Error ? err.message : 'error' })
      }
    }
    setBusy(false)
    setCarrito((prev) => prev.filter((i) => !okKeys.includes(i.key)))
    if (fallidos.length === 0) {
      setOk(`${c.okTexto}: ${okKeys.length} producto${okKeys.length === 1 ? '' : 's'}.`)
    } else {
      setError(`No se pudo guardar: ${fallidos.map((f) => `${f.nombre} (${f.motivo})`).join(', ')}`)
      if (okKeys.length > 0) setOk(`Se guardaron ${okKeys.length} de ${okKeys.length + fallidos.length}.`)
    }
    if (verHistorial) cargarHistorial()
  }

  function cerrar() {
    setAbierto(false)
    setElegido(null)
    setBusqueda('')
    setCantidad('')
    setNota('')
    setCarrito([])
    setError(null)
    setOk(null)
    setVerHistorial(false)
  }

  if (!abierto) {
    return (
      <button type="button" className={`merma-trigger merma-trigger-${tipo}`} onClick={() => setAbierto(true)}>
        {c.boton}
      </button>
    )
  }

  return (
    <div className="camera-overlay">
      <div className="camera-modal manual-modal">
        <div className="modal-top">
          <button type="button" className="btn btn-secondary btn-small" onClick={cerrar}>
            ← Cerrar
          </button>
          <h2>{c.titulo}</h2>
        </div>
        <p className="subtitle">{c.intro}</p>

        {error && <p className="error-text">{error}</p>}
        {ok && <p className="info-text">{ok}</p>}

        {!elegido ? (
          <>
            <input
              type="search"
              className="manual-buscar"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="🔍 Buscar producto por nombre"
              autoFocus
            />
            {cargando && <p className="subtitle">Buscando...</p>}
            <div className="agregar-item-lista">
              {productos.map((p) => (
                <div key={p.id} className="merma-picker-item">
                  <span className="merma-picker-info">
                    <span className="merma-picker-nombre">{p.nombre}</span>
                    <span className="merma-picker-meta">
                      {formatCLP(p.precio ?? 0)}
                      {p.por_peso ? '/kg' : ''} · stock {p.por_peso ? formatGramos(p.stock) : p.stock}
                    </span>
                  </span>
                  <button type="button" className="btn btn-primary btn-small" onClick={() => elegir(p)}>
                    Elegir
                  </button>
                </div>
              ))}
              {!cargando && busqueda.trim() && productos.length === 0 && (
                <p className="subtitle">Sin resultados.</p>
              )}
            </div>

            {carrito.length > 0 && (
              <div className="merma-carrito">
                <p className="merma-carrito-titulo">
                  En la lista ({carrito.length} producto{carrito.length === 1 ? '' : 's'})
                </p>
                <div className="agregar-item-lista">
                  {carrito.map((item) => (
                    <div key={item.key} className="merma-carrito-item">
                      <span className="merma-picker-info">
                        <span className="merma-picker-nombre">{item.producto.nombre}</span>
                        <span className="merma-picker-meta">
                          {item.producto.por_peso ? formatGramos(Number(item.cantidad)) : `${item.cantidad} un.`}
                          {item.nota ? ` · ${item.nota}` : ''}
                        </span>
                      </span>
                      <button type="button" className="btn-link btn-quitar" onClick={() => quitarDelCarrito(item.key)}>
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={guardarTodo}>
                  {busy ? 'Guardando...' : `${c.guardarTexto} (${carrito.length})`}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="merma-elegido">
            <div className="merma-elegido-top">
              <strong className="merma-elegido-nombre">{elegido.nombre}</strong>
              <button type="button" className="btn-link" onClick={() => setElegido(null)}>
                Cambiar producto
              </button>
            </div>
            <label>
              Cantidad {c.cantidadLabel} ({elegido.por_peso ? 'gramos' : 'unidades'})
              <input
                type="number"
                min={1}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="qty-input"
                autoFocus
              />
            </label>
            <label>
              {c.motivoLabel}
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder={c.motivoPlaceholder} />
            </label>
            <button type="button" className="btn btn-primary" onClick={agregarAlCarrito}>
              {c.agregarTexto}
            </button>
          </div>
        )}

        {!elegido && carrito.length === 0 && (
          <p className="subtitle merma-hint">Elige uno o varios productos: se guardan todos juntos al final.</p>
        )}

        <button type="button" className="btn-detalle" onClick={() => setVerHistorial((v) => !v)}>
          {verHistorial ? 'Ocultar historial ▴' : 'Ver historial (30 días) ▾'}
        </button>
        {verHistorial && (
          <div className="merma-historial">
            {historial.length === 0 && <p className="subtitle">{c.vacioTexto}</p>}
            {gruposHistorialPorFecha(historial).map((grupo) => (
              <div key={grupo.fecha} className="merma-historial-grupo">
                <p className="merma-historial-fecha-grupo">{grupo.fechaTexto}</p>
                {grupo.filas.map((m) => (
                  <div key={m.id} className="merma-historial-card">
                    <span className="merma-historial-icono">{tipo === 'merma' ? '🗑️' : '📦'}</span>
                    <div className="merma-historial-info">
                      <p className="merma-historial-nombre">{m.nombre_producto}</p>
                      <p className="subtitle">
                        {m.worker_name}
                        {m.nota ? ` · ${m.nota}` : ''}
                      </p>
                    </div>
                    <span className="merma-historial-cantidad">
                      {m.es_peso ? formatGramos(m.cantidad) : `${m.cantidad} un.`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
