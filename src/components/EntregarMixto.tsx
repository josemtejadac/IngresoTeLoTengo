import { useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { marcarEntregadoMixto, METODO_PAGO_LABEL, METODOS_ARQUEO, type MetodoArqueo, type PedidoTienda } from '../lib/tienda'

interface Props {
  pedido: PedidoTienda
  onEntregado: () => void
}

/** Para cuando el cliente paga con mas de un metodo al recibir (ej. parte tarjeta, parte efectivo). */
export function EntregarMixto({ pedido, onEntregado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [montos, setMontos] = useState<Record<MetodoArqueo, string>>({
    efectivo: '', tarjeta: '', transferencia: '', qr: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suma = METODOS_ARQUEO.reduce((s, m) => s + (Number(montos[m]) || 0), 0)
  const falta = pedido.total - suma

  async function confirmar() {
    if (!window.confirm(`¿Marcar entregado el pedido de ${pedido.nombre_cliente} con pago repartido?`)) return
    setBusy(true)
    setError(null)
    try {
      const payload: Partial<Record<MetodoArqueo, number>> = {}
      for (const m of METODOS_ARQUEO) {
        const n = Number(montos[m]) || 0
        if (n > 0) payload[m] = n
      }
      await marcarEntregadoMixto(pedido.id, payload)
      setAbierto(false)
      onEntregado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(true)}>
        🔀 Mixto
      </button>
    )
  }

  return (
    <div className="pago-mixto-form">
      <p className="subtitle">Reparte los {formatCLP(pedido.total)} entre los métodos con que pagó.</p>
      <div className="pago-mixto-grid">
        {METODOS_ARQUEO.map((m) => (
          <label key={m}>
            {METODO_PAGO_LABEL[m]}
            <input
              type="number"
              min={0}
              value={montos[m]}
              onChange={(e) => setMontos((prev) => ({ ...prev, [m]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <p className={falta === 0 ? 'subtitle' : 'error-text'}>
        {falta === 0 ? '✓ Cuadra con el total.' : `Falta ${formatCLP(falta)} para llegar al total (o sobra si es negativo).`}
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="report-row">
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary btn-small" disabled={busy || falta !== 0} onClick={confirmar}>
          {busy ? 'Guardando...' : 'Confirmar entrega'}
        </button>
      </div>
    </div>
  )
}
