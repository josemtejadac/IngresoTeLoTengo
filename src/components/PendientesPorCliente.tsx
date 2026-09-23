import { useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { agruparPorCliente, clienteNombre, saldo, type PendienteEntry } from '../lib/pendientes'

interface Props {
  pendientes: PendienteEntry[]
  nameDirectory: Record<string, string>
  busyKey: string | null
  onCobrar: (ids: string[], busyKey: string) => void
  onAbonar: (ids: string[], monto: number, busyKey: string) => Promise<boolean>
  /** Solo el admin puede eliminar registros. */
  onEliminar?: (id: string) => void
}

export function PendientesPorCliente({
  pendientes,
  nameDirectory,
  busyKey,
  onCobrar,
  onAbonar,
  onEliminar,
}: Props) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const [abonando, setAbonando] = useState<string | null>(null)
  const [abonoMonto, setAbonoMonto] = useState('')
  const [abonandoDeuda, setAbonandoDeuda] = useState<string | null>(null)
  const [abonoDeudaMonto, setAbonoDeudaMonto] = useState('')
  const grupos = agruparPorCliente(pendientes)
  const cobrados = pendientes.filter((p) => p.pagado).slice(0, 15)

  return (
    <>
      {grupos.length === 0 && <p className="subtitle">No hay deudas por cobrar.</p>}
      {grupos.map((g) => (
        <div key={g.key} className="deuda-cliente">
          <div className="deuda-cliente-head">
            <div>
              <strong>{g.nombre}</strong>
              <p className="subtitle">
                {g.deudas.length} {g.deudas.length === 1 ? 'deuda' : 'deudas'} ·{' '}
                <strong>{formatCLP(g.total)}</strong>
              </p>
            </div>
            <div className="table-controls">
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setAbierto(abierto === g.key ? null : g.key)}
              >
                {abierto === g.key ? 'Ocultar detalle' : 'Ver detalle'}
              </button>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => {
                  setAbonando(abonando === g.key ? null : g.key)
                  setAbonoMonto('')
                }}
              >
                Abonar
              </button>
              <button
                className="btn btn-primary btn-small"
                disabled={busyKey === `all-${g.key}`}
                onClick={() => {
                  if (
                    window.confirm(
                      `¿Cobrar las ${g.deudas.length} deudas de ${g.nombre} por ${formatCLP(g.total)}?`,
                    )
                  ) {
                    onCobrar(
                      g.deudas.map((d) => d.id),
                      `all-${g.key}`,
                    )
                  }
                }}
              >
                {busyKey === `all-${g.key}` ? 'Guardando...' : `Cobrar todo (${formatCLP(g.total)})`}
              </button>
            </div>
          </div>
          {abonando === g.key && (
            <div className="report-row">
              <label>
                Abono general (se descuenta de las más antiguas; debe {formatCLP(g.total)})
                <input
                  type="number"
                  min={1}
                  max={g.total}
                  value={abonoMonto}
                  onChange={(e) => setAbonoMonto(e.target.value)}
                  autoFocus
                />
              </label>
              <button
                className="btn btn-primary btn-small"
                disabled={busyKey === `abono-${g.key}` || !Number(abonoMonto)}
                onClick={async () => {
                  const ok = await onAbonar(
                    g.deudas.map((d) => d.id),
                    Number(abonoMonto),
                    `abono-${g.key}`,
                  )
                  if (ok) setAbonando(null)
                }}
              >
                {busyKey === `abono-${g.key}` ? 'Guardando...' : 'Registrar abono'}
              </button>
            </div>
          )}
          {abierto === g.key && (
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th>Monto</th>
                  <th>Registró</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.deudas.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.created_at).toLocaleDateString('es-CL')}</td>
                    <td>{d.cliente?.trim() ? d.comentario || '—' : '—'}</td>
                    <td>
                      {formatCLP(d.monto)}
                      {d.abonado > 0 && (
                        <span className="subtitle">
                          {' '}
                          (abonado {formatCLP(d.abonado)}, resta {formatCLP(saldo(d))})
                        </span>
                      )}
                    </td>
                    <td>{nameDirectory[d.worker_id] ?? '—'}</td>
                    <td className="table-controls">
                      {abonandoDeuda === d.id ? (
                        <>
                          <input
                            type="number"
                            min={1}
                            max={saldo(d)}
                            value={abonoDeudaMonto}
                            onChange={(e) => setAbonoDeudaMonto(e.target.value)}
                            placeholder={`Máx ${saldo(d)}`}
                            className="qty-input"
                            autoFocus
                          />
                          <button
                            className="btn btn-primary btn-small"
                            disabled={busyKey === `abono-${d.id}` || !Number(abonoDeudaMonto)}
                            onClick={async () => {
                              const ok = await onAbonar([d.id], Number(abonoDeudaMonto), `abono-${d.id}`)
                              if (ok) setAbonandoDeuda(null)
                            }}
                          >
                            {busyKey === `abono-${d.id}` ? 'Guardando...' : 'Guardar'}
                          </button>
                          <button className="btn-link" onClick={() => setAbonandoDeuda(null)}>
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn btn-secondary btn-small"
                            onClick={() => {
                              setAbonandoDeuda(d.id)
                              setAbonoDeudaMonto('')
                            }}
                          >
                            Abonar
                          </button>
                          <button
                            className="btn btn-secondary btn-small"
                            disabled={busyKey === d.id}
                            onClick={() => onCobrar([d.id], d.id)}
                          >
                            {busyKey === d.id ? 'Guardando...' : 'Cobrar'}
                          </button>
                        </>
                      )}
                      {onEliminar && (
                        <button
                          className="btn btn-danger btn-small"
                          onClick={() => {
                            if (window.confirm('¿Eliminar esta deuda? No se puede deshacer.')) {
                              onEliminar(d.id)
                            }
                          }}
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {cobrados.length > 0 && (
        <>
          <h3>Últimos cobrados</h3>
          <table className="table">
            <tbody>
              {cobrados.map((p) => (
                <tr key={p.id} className="pendiente-paid">
                  <td>{new Date(p.created_at).toLocaleDateString('es-CL')}</td>
                  <td>{clienteNombre(p)}</td>
                  <td>{formatCLP(p.monto)}</td>
                  <td>
                    Cobrado por {p.paid_by ? (nameDirectory[p.paid_by] ?? '—') : '—'}
                    {p.paid_at ? ` (${new Date(p.paid_at).toLocaleDateString('es-CL')})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}
