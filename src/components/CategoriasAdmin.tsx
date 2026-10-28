import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { categoriasDestacadas } from '../lib/temaTienda'
import { claveCategoria, productoFotoUrl, unificarCategoria, type Producto } from '../lib/inventario'

interface FilaCategoria {
  categoria: string
  /** Productos activos (los que se ven en la tienda / inventario). */
  activos: number
}

interface Props {
  /** Avisa que cambiaron categorias (para recargar la lista de productos del inventario). */
  onCambio: () => void
  /** Abre la ventana Editar de un producto (ahi se le cambia la categoria o subcategoria a uno solo). */
  onEditar: (p: Producto) => void
  /** Cambia cada vez que se recarga el inventario: asi esta seccion se pone al dia despues de editar algo. */
  actualizado: unknown
}

function nombreBonito(c: string): string {
  return c.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Categorias del inventario. Se toca una para ver sus productos y subcategorias, cambiarle el nombre o pasar
 * todos sus productos a otra categoria (ej. al terminar Halloween, pasar todo a Snacks Confites).
 */
export function CategoriasAdmin({ onCambio, onEditar, actualizado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<FilaCategoria[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [productos, setProductos] = useState<Producto[]>([])
  const [accion, setAccion] = useState<'renombrar' | 'mover' | null>(null)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [destino, setDestino] = useState('')
  const [busy, setBusy] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('ingreso_productos')
      .select('categoria')
      .eq('active', true)
      .not('categoria', 'is', null)
      .limit(5000)
    if (err) {
      setError(err.message)
      return
    }
    const mapa = new Map<string, number>()
    for (const r of (data as { categoria: string }[]) ?? []) mapa.set(r.categoria, (mapa.get(r.categoria) ?? 0) + 1)
    const destacadas = categoriasDestacadas()
    setFilas(
      [...mapa.entries()]
        .map(([categoria, activos]) => ({ categoria, activos }))
        .sort(
          (a, b) =>
            Number(destacadas.includes(b.categoria)) - Number(destacadas.includes(a.categoria)) ||
            nombreBonito(a.categoria).localeCompare(nombreBonito(b.categoria)),
        ),
    )
  }, [])

  const cargarProductos = useCallback(async (categoria: string) => {
    const { data, error: err } = await supabase
      .from('ingreso_productos')
      .select('*')
      .eq('categoria', categoria)
      .eq('active', true)
      .order('nombre')
      .limit(1000)
    if (err) {
      setError(err.message)
      return
    }
    setProductos((data as Producto[]) ?? [])
  }, [])

  useEffect(() => {
    if (!abierto) return
    cargar()
    if (sel) cargarProductos(sel)
  }, [abierto, sel, cargar, cargarProductos, actualizado])

  function abrirCategoria(c: string) {
    setSel(c)
    setProductos([])
    setAccion(null)
    setMensaje(null)
    setError(null)
  }

  function volver() {
    setSel(null)
    setAccion(null)
    setError(null)
  }

  /** Pasa TODOS los productos de la categoria (tambien los del catalogo oculto) a `nueva`. */
  async function cambiarCategoria(nueva: string, quitarSubcategorias: boolean) {
    if (!sel) return
    setBusy(true)
    setError(null)
    setMensaje(null)
    try {
      const campos: Record<string, string | null> = { categoria: nueva }
      if (quitarSubcategorias) campos.subcategoria = null
      let { error: err } = await supabase.from('ingreso_productos').update(campos).eq('categoria', sel)
      // Si la base aun no tiene subcategorias, se cambia solo la categoria.
      if (err && /subcategoria/i.test(err.message)) {
        ;({ error: err } = await supabase.from('ingreso_productos').update({ categoria: nueva }).eq('categoria', sel))
      }
      if (err) throw err
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo hacer el cambio')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function renombrar() {
    if (!sel) return
    const otras = filas.map((f) => f.categoria).filter((c) => c !== sel)
    const nueva = unificarCategoria(nombreNuevo, otras)
    if (!nueva || claveCategoria(nueva) === claveCategoria(sel)) {
      setError('Escribe el nombre nuevo.')
      return
    }
    const yaExiste = otras.includes(nueva)
    const texto = yaExiste
      ? `Ya existe la categoría "${nombreBonito(nueva)}". ¿Juntar los productos de "${nombreBonito(sel)}" con ella?`
      : `¿Cambiar el nombre de "${nombreBonito(sel)}" a "${nombreBonito(nueva)}"?`
    if (!window.confirm(texto)) return
    if (await cambiarCategoria(nueva, yaExiste)) {
      setMensaje(yaExiste ? `Listo: se juntó con "${nombreBonito(nueva)}".` : `Listo: ahora se llama "${nombreBonito(nueva)}".`)
      setAccion(null)
      setNombreNuevo('')
      setSel(nueva)
      onCambio()
    }
  }

  async function moverTodo() {
    if (!sel || !destino) return
    const n = filas.find((f) => f.categoria === sel)?.activos ?? productos.length
    if (
      !window.confirm(
        `¿Pasar los ${n} producto(s) de "${nombreBonito(sel)}" a "${nombreBonito(destino)}"?\n\n` +
          `"${nombreBonito(sel)}" dejará de aparecer en la tienda.`,
      )
    ) {
      return
    }
    if (await cambiarCategoria(destino, true)) {
      setMensaje(`Listo: los productos de "${nombreBonito(sel)}" ahora están en "${nombreBonito(destino)}".`)
      setAccion(null)
      setDestino('')
      setSel(null)
      onCambio()
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn-detalle" onClick={() => setAbierto(true)}>
        🗂️ Categorías
      </button>
    )
  }

  const destacadas = categoriasDestacadas()

  // ---- Lista de categorias ----
  if (!sel) {
    return (
      <div className="categorias-admin">
        <div className="categorias-admin-head">
          <strong>🗂️ Categorías</strong>
          <button type="button" className="btn-link" onClick={() => setAbierto(false)}>
            Cerrar
          </button>
        </div>
        <p className="subtitle">Toca una categoría para ver sus productos, cambiarle el nombre o pasarlos a otra.</p>
        {mensaje && <p className="info-text">{mensaje}</p>}
        {error && <p className="error-text">{error}</p>}
        <ul className="categorias-lista">
          {filas.map((f) => (
            <li key={f.categoria}>
              <button type="button" className="categorias-fila" onClick={() => abrirCategoria(f.categoria)}>
                <span className="categorias-fila-nombre">
                  {destacadas.includes(f.categoria) && '🎃 '}
                  {nombreBonito(f.categoria)}
                  {destacadas.includes(f.categoria) && <span className="categorias-badge">Primera en la tienda</span>}
                </span>
                <span className="categorias-fila-cant">
                  {f.activos} producto{f.activos === 1 ? '' : 's'} ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ---- Una categoria abierta ----
  const subcats = new Map<string, number>()
  for (const p of productos) if (p.subcategoria) subcats.set(p.subcategoria, (subcats.get(p.subcategoria) ?? 0) + 1)
  const otras = filas.map((f) => f.categoria).filter((c) => c !== sel)

  return (
    <div className="categorias-admin">
      <div className="categorias-admin-head">
        <button type="button" className="btn-link" onClick={volver}>
          ← Todas las categorías
        </button>
        <button type="button" className="btn-link" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>
      <div>
        <h3 className="categorias-titulo">
          {destacadas.includes(sel) && '🎃 '}
          {nombreBonito(sel)}
        </h3>
        <p className="subtitle">
          {productos.length} producto{productos.length === 1 ? '' : 's'} en la tienda
        </p>
      </div>
      {mensaje && <p className="info-text">{mensaje}</p>}
      {error && <p className="error-text">{error}</p>}

      {accion === null && (
        <div className="categorias-acciones">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setAccion('renombrar')
              setNombreNuevo(nombreBonito(sel).toUpperCase())
              setMensaje(null)
            }}
          >
            ✏️ Cambiar nombre
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setAccion('mover')
              setDestino('')
              setMensaje(null)
            }}
          >
            📦 Pasar todo a otra categoría
          </button>
        </div>
      )}

      {accion === 'renombrar' && (
        <div className="categorias-form">
          <label>
            Nombre nuevo
            <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} autoFocus />
          </label>
          <div className="categorias-form-botones">
            <button type="button" className="btn btn-secondary" onClick={() => setAccion(null)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={renombrar} disabled={busy || !nombreNuevo.trim()}>
              {busy ? 'Guardando...' : 'Guardar nombre'}
            </button>
          </div>
        </div>
      )}

      {accion === 'mover' && (
        <div className="categorias-form">
          <label>
            Pasar todos sus productos a
            <select value={destino} onChange={(e) => setDestino(e.target.value)}>
              <option value="">Elige una categoría…</option>
              {otras.map((c) => (
                <option key={c} value={c}>
                  {nombreBonito(c)}
                </option>
              ))}
            </select>
          </label>
          <p className="subtitle">
            Los productos quedan en esa categoría (sin subcategoría) y &quot;{nombreBonito(sel)}&quot; deja de aparecer en
            la tienda.
          </p>
          <div className="categorias-form-botones">
            <button type="button" className="btn btn-secondary" onClick={() => setAccion(null)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={moverTodo} disabled={busy || !destino}>
              {busy ? 'Moviendo...' : 'Pasar todo'}
            </button>
          </div>
        </div>
      )}

      {subcats.size > 0 && (
        <div className="categorias-subcats">
          <span className="subtitle">Subcategorías:</span>
          {[...subcats.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([s, n]) => (
              <span key={s} className="categorias-subcat">
                {s.toLowerCase()} ({n})
              </span>
            ))}
        </div>
      )}

      <p className="subtitle categorias-ayuda">
        Para cambiar un solo producto de categoría o subcategoría, toca <strong>Editar</strong>.
      </p>
      <ul className="categorias-productos">
        {productos.map((p) => (
          <li key={p.id}>
            {p.foto_path ? (
              <img src={productoFotoUrl(p.foto_path)} alt="" className="categorias-producto-foto" loading="lazy" />
            ) : (
              <span className="categorias-producto-foto categorias-producto-foto-vacia">🛒</span>
            )}
            <span className="categorias-producto-info">
              <span className="categorias-producto-nombre">{p.nombre}</span>
              {p.subcategoria && <span className="categorias-subcat">{p.subcategoria.toLowerCase()}</span>}
            </span>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => onEditar(p)}>
              Editar
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
