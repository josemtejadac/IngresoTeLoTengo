import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { unificarCategoria } from '../lib/inventario'

interface FilaCategoria {
  categoria: string
  total: number
  activos: number
}

interface Props {
  /** Avisa que cambiaron categorias (para recargar la lista de productos). */
  onCambio: () => void
}

/**
 * Categorias del inventario: cuantos productos tiene cada una y la opcion de mover TODOS sus productos a otra
 * categoria (ej. al terminar Halloween, pasar todo HALLOWEEN a SNACKS CONFITES y la categoria desaparece sola).
 * Escribir un nombre nuevo equivale a cambiarle el nombre a la categoria.
 */
export function CategoriasAdmin({ onCambio }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [filas, setFilas] = useState<FilaCategoria[]>([])
  const [destinos, setDestinos] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.from('ingreso_productos').select('categoria, active').not('categoria', 'is', null).limit(5000)
    if (err) {
      setError(err.message)
      return
    }
    const mapa = new Map<string, FilaCategoria>()
    for (const r of (data as { categoria: string; active: boolean }[]) ?? []) {
      const f = mapa.get(r.categoria) ?? { categoria: r.categoria, total: 0, activos: 0 }
      f.total++
      if (r.active) f.activos++
      mapa.set(r.categoria, f)
    }
    setFilas([...mapa.values()].sort((a, b) => b.activos - a.activos || a.categoria.localeCompare(b.categoria)))
  }, [])

  useEffect(() => {
    if (abierto) cargar()
  }, [abierto, cargar])

  async function mover(origen: string) {
    const destino = unificarCategoria(destinos[origen] ?? '', filas.map((f) => f.categoria))
    if (!destino || destino === origen) {
      setError('Escribe o elige la categoría a la que quieres pasar los productos.')
      return
    }
    const fila = filas.find((f) => f.categoria === origen)
    if (
      !window.confirm(
        `¿Pasar los ${fila?.total ?? ''} producto(s) de "${origen.replace(/\s+/g, ' ')}" a "${destino.replace(/\s+/g, ' ')}"?` +
          '\n\nLa categoría vacía deja de aparecer en la tienda. Las subcategorías de esos productos se quitan.',
      )
    ) {
      return
    }
    setBusy(origen)
    setError(null)
    setMensaje(null)
    try {
      let { error: err } = await supabase
        .from('ingreso_productos')
        .update({ categoria: destino, subcategoria: null })
        .eq('categoria', origen)
      // Si la base aun no tiene subcategorias, se mueve solo la categoria.
      if (err && /subcategoria/i.test(err.message)) {
        ;({ error: err } = await supabase.from('ingreso_productos').update({ categoria: destino }).eq('categoria', origen))
      }
      if (err) throw err
      setMensaje(`Listo: los productos de "${origen.replace(/\s+/g, ' ')}" ahora están en "${destino.replace(/\s+/g, ' ')}".`)
      setDestinos((d) => ({ ...d, [origen]: '' }))
      await cargar()
      onCambio()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mover la categoría')
    } finally {
      setBusy(null)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn-detalle" onClick={() => setAbierto(true)}>
        🗂️ Categorías (mover o renombrar)
      </button>
    )
  }

  return (
    <div className="categorias-admin">
      <div className="categorias-admin-head">
        <strong>🗂️ Categorías</strong>
        <button type="button" className="btn-link" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
      </div>
      <p className="subtitle">
        Para cambiar un solo producto usa <strong>Editar</strong> en ese producto. Aquí mueves todos los productos de una
        categoría a otra (o le cambias el nombre escribiendo uno nuevo).
      </p>
      {mensaje && <p className="info-text">{mensaje}</p>}
      {error && <p className="error-text">{error}</p>}
      <datalist id="categorias-destino">
        {filas.map((f) => (
          <option key={f.categoria} value={f.categoria} />
        ))}
      </datalist>
      <ul className="categorias-admin-lista">
        {filas.map((f) => (
          <li key={f.categoria}>
            <span className="categorias-admin-nombre">
              {f.categoria.replace(/\s+/g, ' ')}
              <span className="subtitle">
                {' '}
                · {f.activos} activo{f.activos === 1 ? '' : 's'}
                {f.total > f.activos ? ` · ${f.total - f.activos} oculto${f.total - f.activos === 1 ? '' : 's'}` : ''}
              </span>
            </span>
            <span className="categorias-admin-mover">
              <input
                list="categorias-destino"
                placeholder="Pasar todo a…"
                value={destinos[f.categoria] ?? ''}
                onChange={(e) => setDestinos((d) => ({ ...d, [f.categoria]: e.target.value }))}
              />
              <button
                type="button"
                className="btn btn-secondary btn-small"
                disabled={busy !== null || !(destinos[f.categoria] ?? '').trim()}
                onClick={() => mover(f.categoria)}
              >
                {busy === f.categoria ? 'Moviendo...' : 'Mover'}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
