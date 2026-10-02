import { useCallback, useEffect, useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { loadClientesSeguimiento, type ClienteSeguimiento } from '../lib/tienda'

function mesActualISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split('-').map(Number)
  const desde = `${mes}-01`
  const ultimoDia = new Date(anio, m, 0).getDate()
  const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`
  return { desde, hasta }
}

/** Seguimiento de clientes por depto: cuantas veces compraron y cuanto, para detectar clientes frecuentes a quien mandarles cupones. */
export function ClientesSeguimiento() {
  const [mes, setMes] = useState(mesActualISO)
  const [filas, setFilas] = useState<ClienteSeguimiento[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const { desde, hasta } = rangoDelMes(mes)
      setFilas(await loadClientesSeguimiento(desde, hasta))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando el seguimiento de clientes')
    } finally {
      setBusy(false)
    }
  }, [mes])

  useEffect(() => {
    cargar()
  }, [cargar])

  const totalGastado = filas.reduce((sum, f) => sum + f.total, 0)
  const totalPedidos = filas.reduce((sum, f) => sum + f.pedidos, 0)

  return (
    <section className="card">
      <div className="section-header">
        <h2>Seguimiento de clientes (clientes potenciales)</h2>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>
      <p className="subtitle">
        Agrupado por torre/depto: cuántas veces compró y cuánto gastó en el mes. Útil para saber a quién
        mandarle un cupón (solo cuenta pedidos ya entregados y pagados).
      </p>
      {error && <p className="error-text">{error}</p>}
      {busy && <p className="subtitle">Cargando...</p>}
      {!busy && filas.length === 0 && !error && (
        <p className="subtitle">No hay compras entregadas y pagadas ese mes.</p>
      )}
      {filas.length > 0 && (
        <>
          <p className="subtitle">
            {filas.length} depto(s) · {totalPedidos} pedido(s) · Total: <strong>{formatCLP(totalGastado)}</strong>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Torre</th>
                <th>Depto</th>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>Pedidos</th>
                <th>Total gastado</th>
                <th>Promedio</th>
                <th>Última compra</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={`${f.torre}-${f.depto}`}>
                  <td>{f.torre}</td>
                  <td>{f.depto}</td>
                  <td>{f.nombre ?? '—'}</td>
                  <td>{f.telefono ? <a href={`tel:${f.telefono}`}>{f.telefono}</a> : '—'}</td>
                  <td>{f.pedidos}</td>
                  <td>
                    <strong>{formatCLP(f.total)}</strong>
                  </td>
                  <td>{formatCLP(Math.round(f.total / f.pedidos))}</td>
                  <td>
                    {new Date(f.ultima_compra).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
