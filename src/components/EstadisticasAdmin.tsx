import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { formatGramos } from '../lib/peso'
import {
  loadEstadisticasAdmin,
  VENTAS_PARA_ESTADISTICAS,
  type EstadisticasAdmin,
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

  const load = useCallback(async () => {
    try {
      setDatos(await loadEstadisticasAdmin(90))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando las estadísticas')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  return (
    <section className="card">
      <h2>Estadísticas — última actualización automática</h2>
      <p className="subtitle">
        Basado en los pedidos de la tienda y manuales entregados en los últimos {datos.periodo_dias} días.
      </p>
      <p>
        Ingresos del período: <strong>{formatCLP(datos.ingresos_periodo)}</strong> · Ventas totales acumuladas:{' '}
        <strong>{datos.total_ventas}</strong>
      </p>

      <h3>Consejos</h3>
      <ul className="estad-consejos">
        {generarConsejos(datos).map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>

      <h3>Lo que más se vende</h3>
      {datos.top_productos.length === 0 ? (
        <p className="subtitle">Sin ventas en este período.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Vendido</th>
              <th>Ingresos</th>
            </tr>
          </thead>
          <tbody>
            {datos.top_productos.map((p) => (
              <tr key={p.producto_id}>
                <td className="col-nombre">{p.nombre}</td>
                <td>{textoUnidades(p)}</td>
                <td>{formatCLP(p.ingresos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Lo que casi no se vende</h3>
      {datos.sin_venta.length === 0 ? (
        <p className="subtitle">Todos los productos activos con precio se han vendido en este período.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Precio</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {datos.sin_venta.map((p) => (
              <tr key={p.producto_id}>
                <td className="col-nombre">{p.nombre}</td>
                <td>{formatCLP(p.precio)}</td>
                <td>{p.stock}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
