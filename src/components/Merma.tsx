import { useCallback, useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import {
  loadCatalogoTienda,
  loadMermasHistorial,
  registrarMerma,
  type MermaHistorial,
  type ProductoTienda,
} from '../lib/tienda'

/** El personal registra un producto perdido/echado a perder: descuenta stock y queda guardado con fecha. */
export function Merma() {
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [productos, setProductos] = useState<ProductoTienda[]>([])
  const [cargando, setCargando] = useState(false)
  const [elegido, setElegido] = useState<ProductoTienda | null>(null)
  const [cantidad, setCantidad] = useState('')
  const [nota, setNota] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [historial, setHistorial] = useState<MermaHistorial[]>([])
  const [verHistorial, setVerHistorial] = useState(false)

  useEffect(() => {
    if (!abierto || elegido) return
    setCargando(true)
    const t = setTimeout(() => {
      loadCatalogoTienda({ search: busqueda.trim() || undefined })
        .then((r) => setProductos(r.slice(0, 8)))
        .catch((err) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los productos'))
        .finally(() => setCargando(false))
    }, 250)
    return () => clearTimeout(t)
  }, [abierto, elegido, busqueda])

  const cargarHistorial = useCallback(() => {
    loadMermasHistorial(30)
      .then(setHistorial)
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo cargar el historial'))
  }, [])

  useEffect(() => {
    if (verHistorial) cargarHistorial()
  }, [verHistorial, cargarHistorial])

  function elegir(p: ProductoTienda) {
    setElegido(p)
    setCantidad('')
    setError(null)
    setOk(null)
  }

  async function guardar() {
    if (!elegido) return
    const n = Number(cantidad)
    if (!n || n <= 0) {
      setError('Pon una cantidad válida.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await registrarMerma(elegido.id, n, nota)
      setOk(`Merma guardada: ${elegido.nombre} · ${elegido.por_peso ? formatGramos(n) : `${n} un.`}`)
      setElegido(null)
      setCantidad('')
      setNota('')
      setBusqueda('')
      if (verHistorial) cargarHistorial()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la merma')
    } finally {
      setBusy(false)
    }
  }

  function cerrar() {
    setAbierto(false)
    setElegido(null)
    setBusqueda('')
    setCantidad('')
    setNota('')
    setError(null)
    setOk(null)
    setVerHistorial(false)
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(true)}>
        🗑️ Merma
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
          <h2>Registrar merma</h2>
        </div>
        <p className="subtitle">
          Para productos que se perdieron, se echaron a perder o se rompieron. Descuenta el stock y queda guardado con
          fecha y quién lo registró.
        </p>

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
                <div key={p.id} className="agregar-item-fila">
                  <span className="agregar-item-nombre">
                    {p.nombre} · {formatCLP(p.precio)}
                    {p.por_peso ? '/kg' : ''} · stock{' '}
                    {p.por_peso ? formatGramos(p.stock_max ?? 0) : (p.stock_max ?? 0)}
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
          </>
        ) : (
          <div className="manual-peso">
            <strong>{elegido.nombre}</strong>
            <button type="button" className="btn-link" onClick={() => setElegido(null)}>
              Cambiar producto
            </button>
            <label>
              {elegido.por_peso ? 'Peso perdido (gramos)' : 'Cantidad perdida (unidades)'}
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
              Motivo (opcional)
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Ej: se echó a perder, se cayó..."
              />
            </label>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={guardar}>
              {busy ? 'Guardando...' : 'Guardar merma'}
            </button>
          </div>
        )}

        <button type="button" className="btn-link" onClick={() => setVerHistorial((v) => !v)}>
          {verHistorial ? 'Ocultar historial ▴' : 'Ver historial (30 días) ▾'}
        </button>
        {verHistorial && (
          <div className="agregar-item-lista">
            {historial.length === 0 && <p className="subtitle">Sin mermas registradas.</p>}
            {historial.map((m) => (
              <div key={m.id} className="agregar-item-fila">
                <span className="agregar-item-nombre">
                  {new Date(m.created_at).toLocaleDateString('es-CL')} · {m.nombre_producto} ·{' '}
                  {m.es_peso ? formatGramos(m.cantidad) : `${m.cantidad} un.`} · {m.worker_name}
                  {m.nota ? ` · ${m.nota}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
