import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import { updateProducto } from '../lib/inventario'
import {
  loadEstadisticasAdmin,
  preguntarEstadisticasIA,
  VENTAS_PARA_ESTADISTICAS,
  type EstadisticasAdmin,
  type HistorialIA,
} from '../lib/estadisticas'

function textoUnidades(p: { unidades: number; gramos: number }): string {
  const partes: string[] = []
  if (p.unidades > 0) partes.push(`${p.unidades} un`)
  if (p.gramos > 0) partes.push(formatGramos(p.gramos))
  return partes.join(' · ') || '—'
}

/** Genera consejos simples a partir de los datos, sin depender de IA. */
function generarConsejos(e: EstadisticasAdmin): string[] {
  const consejos: string[] = []
  const estrella = e.top_productos[0]
  if (estrella) {
    consejos.push(
      `«${estrella.nombre}» es tu producto estrella este período (${textoUnidades(estrella)} vendidas, ${formatCLP(estrella.ingresos)}). No lo dejes sin stock.`,
    )
  }
  if (e.sin_venta.length > 0) {
    const ejemplos = e.sin_venta.slice(0, 3).map((p) => p.nombre).join(', ')
    consejos.push(
      `${e.sin_venta.length} producto(s) activo(s) no se han vendido en ${e.periodo_dias} días, por ejemplo: ${ejemplos}. Revisa el precio, la foto o si conviene ocultarlos.`,
    )
  }
  const sinFoto = e.top_productos.filter((p) => p.ingresos > 0).length
  if (sinFoto >= 5) {
    consejos.push('Tienes varios productos que se venden bien: considera destacarlos o asegurar que siempre tengan stock.')
  }
  if (consejos.length === 0) {
    consejos.push('Todavía no hay suficientes ventas en este período para sacar conclusiones claras.')
  }
  return consejos
}

/** Estadisticas de venta por producto, solo para el admin. Se desbloquea con datos reales y se actualiza sola. */
export function EstadisticasAdmin() {
  const [datos, setDatos] = useState<EstadisticasAdmin | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historialIA, setHistorialIA] = useState<HistorialIA[]>([])
  const [preguntaIA, setPreguntaIA] = useState('')
  const [cargandoIA, setCargandoIA] = useState(false)
  const [errorIA, setErrorIA] = useState<string | null>(null)
  const [destacados, setDestacados] = useState<Record<string, boolean>>({})
  const [fijandoId, setFijandoId] = useState<string | null>(null)
  const yaPidioAnalisis = useRef(false)

  const load = useCallback(async () => {
    try {
      setDatos(await loadEstadisticasAdmin())
      setError(null)
    } catch {
      setError('Reconectando... esto se actualiza solo en unos segundos.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Para saber cuales de "Lo que más se vende" ya están fijados en la tienda (y poder marcarlos aquí mismo).
  useEffect(() => {
    const ids = datos?.top_productos.map((p) => p.producto_id) ?? []
    if (ids.length === 0) return
    supabase
      .from('ingreso_productos')
      .select('id, destacado')
      .in('id', ids)
      .then(({ data }) => {
        const mapa: Record<string, boolean> = {}
        for (const r of (data as { id: string; destacado: boolean }[]) ?? []) mapa[r.id] = r.destacado
        setDestacados(mapa)
      })
  }, [datos])

  async function alternarFijado(productoId: string, actual: boolean) {
    setFijandoId(productoId)
    try {
      await updateProducto(productoId, { destacado: !actual })
      setDestacados((prev) => ({ ...prev, [productoId]: !actual }))
    } catch {
      // si falla, el estado no cambia visualmente y el admin puede reintentar
    } finally {
      setFijandoId(null)
    }
  }

  async function preguntarIA(pregunta: string) {
    if (!datos) return
    setCargandoIA(true)
    setErrorIA(null)
    try {
      const respuesta = await preguntarEstadisticasIA(datos, pregunta, historialIA)
      setHistorialIA((prev) => [
        ...prev,
        ...(pregunta ? [{ role: 'user' as const, text: pregunta }] : []),
        { role: 'model' as const, text: respuesta },
      ])
      setPreguntaIA('')
    } catch (err) {
      setErrorIA(err instanceof Error ? err.message : 'No se pudo consultar a la IA')
    } finally {
      setCargandoIA(false)
    }
  }

  // Al desbloquearse (100+ ventas), pide sola un primer analisis, sin que el admin tenga que preguntar nada.
  useEffect(() => {
    if (!datos || datos.total_ventas < VENTAS_PARA_ESTADISTICAS || yaPidioAnalisis.current) return
    yaPidioAnalisis.current = true
    preguntarIA('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos])

  // Se actualiza sola: cualquier pedido nuevo, entregado o cancelado recalcula las estadisticas.
  useEffect(() => {
    const channel = supabase
      .channel('ingreso_estadisticas_admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_pedidos_tienda' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_pedidos_tienda_items' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  if (error) {
    return (
      <section className="card">
        <h2>Estadísticas</h2>
        <p className="error-text">{error}</p>
      </section>
    )
  }

  if (!datos) {
    return (
      <section className="card">
        <h2>Estadísticas</h2>
        <p className="subtitle">Cargando...</p>
      </section>
    )
  }

  if (datos.total_ventas < VENTAS_PARA_ESTADISTICAS) {
    const pct = Math.min(100, Math.round((datos.total_ventas / VENTAS_PARA_ESTADISTICAS) * 100))
    return (
      <section className="card">
        <h2>Estadísticas</h2>
        <p className="subtitle">
          Se desbloquean solas cuando la tienda acumule {VENTAS_PARA_ESTADISTICAS} ventas entregadas (pedidos de la
          tienda online o manuales). Llevas <strong>{datos.total_ventas}</strong> de {VENTAS_PARA_ESTADISTICAS}.
        </p>
        <div className="estad-progreso">
          <div className="estad-progreso-barra" style={{ width: `${pct}%` }} />
        </div>
      </section>
    )
  }

  const maxIngresos = Math.max(1, ...datos.top_productos.map((p) => p.ingresos))

  return (
    <section className="card estad-card">
      <div className="estad-header">
        <h2>📊 Estadísticas</h2>
        <span className="subtitle">Últimos {datos.periodo_dias} días · se actualiza sola</span>
      </div>

      <div className="estad-stats-grid">
        <div className="estad-stat-tile estad-stat-verde">
          <span className="estad-stat-icono">💰</span>
          <div>
            <p className="estad-stat-label">Ingresos del período</p>
            <p className="estad-stat-valor">{formatCLP(datos.ingresos_periodo)}</p>
          </div>
        </div>
        <div className="estad-stat-tile estad-stat-azul">
          <span className="estad-stat-icono">🧾</span>
          <div>
            <p className="estad-stat-label">Ventas totales acumuladas</p>
            <p className="estad-stat-valor">{datos.total_ventas}</p>
          </div>
        </div>
      </div>

      <div className="estad-bloque">
        <h3>💡 Consejos rápidos</h3>
        <div className="estad-consejos">
          {generarConsejos(datos).map((c, i) => (
            <div key={i} className="estad-consejo-item">
              {c}
            </div>
          ))}
        </div>
      </div>

      <div className="estad-bloque">
        <h3>🏆 Lo que más se vende</h3>
        <p className="subtitle">
          Fija los que quieras que aparezcan siempre primero en la tienda (antes que el resto, salvo que se agoten).
        </p>
        {datos.top_productos.length === 0 ? (
          <p className="subtitle">Sin ventas en este período.</p>
        ) : (
          <div className="estad-top-lista">
            {datos.top_productos.map((p, i) => {
              const fijado = destacados[p.producto_id] ?? false
              const medalla = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
              return (
                <div key={p.producto_id} className="estad-top-item">
                  <span className="estad-top-rank">{medalla}</span>
                  <div className="estad-top-info">
                    <p className="estad-top-nombre">{p.nombre}</p>
                    <p className="subtitle">
                      {textoUnidades(p)} vendidas · {formatCLP(p.ingresos)}
                    </p>
                    <div className="estad-top-barra-fondo">
                      <div
                        className="estad-top-barra"
                        style={{ width: `${Math.max(4, Math.round((p.ingresos / maxIngresos) * 100))}%` }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className={fijado ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'}
                    disabled={fijandoId === p.producto_id}
                    onClick={() => alternarFijado(p.producto_id, fijado)}
                  >
                    {fijandoId === p.producto_id ? '...' : fijado ? '📌 Fijado' : '📌 Fijar'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="estad-bloque">
        <h3>🐢 Lo que casi no se vende</h3>
        {datos.sin_venta.length === 0 ? (
          <p className="subtitle">Todos los productos activos con precio se han vendido en este período.</p>
        ) : (
          <div className="estad-sinventa-lista">
            {datos.sin_venta.map((p) => (
              <div key={p.producto_id} className="estad-sinventa-item">
                <span className="estad-sinventa-nombre">{p.nombre}</span>
                <span className="subtitle">
                  {formatCLP(p.precio)} · stock {p.stock}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="estad-bloque estad-ia-bloque">
        <h3>🤖 Asistente de datos (IA)</h3>
        <p className="subtitle">
          Analiza estas mismas cifras y te puede responder preguntas sobre tu negocio, en lenguaje natural.
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-small"
          disabled={cargandoIA}
          onClick={() => preguntarIA('')}
        >
          {cargandoIA ? 'Analizando...' : '🔍 Analizar todo de nuevo'}
        </button>
        <div className="estad-ia-chat">
          {historialIA.map((h, i) => (
            <p key={i} className={h.role === 'user' ? 'estad-ia-pregunta' : 'estad-ia-respuesta'}>
              {h.role === 'user' ? h.text : h.text.split('\n').map((linea, j) => <span key={j}>{linea}<br /></span>)}
            </p>
          ))}
          {cargandoIA && <p className="subtitle">Pensando...</p>}
        </div>
        {errorIA && <p className="error-text">{errorIA}</p>}
        <form
          className="report-row"
          onSubmit={(e) => {
            e.preventDefault()
            if (preguntaIA.trim() && !cargandoIA) preguntarIA(preguntaIA.trim())
          }}
        >
          <input
            value={preguntaIA}
            onChange={(e) => setPreguntaIA(e.target.value)}
            placeholder="Ej: ¿qué producto debería promocionar esta semana?"
            disabled={cargandoIA}
          />
          <button type="submit" className="btn btn-primary btn-small" disabled={cargandoIA || !preguntaIA.trim()}>
            Preguntar
          </button>
        </form>
      </div>
    </section>
  )
}
