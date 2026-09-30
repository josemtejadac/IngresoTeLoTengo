import { useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { fijarPagoMixto, METODO_PAGO_LABEL, METODOS_ARQUEO, type MetodoArqueo, type PedidoTienda } from '../lib/tienda'

interface Props {
  pedido: PedidoTienda
  onFijado: () => void
}

/** Deja marcar (o corregir) que un pedido ya entregado se pago repartido entre varios metodos. */
export function PagoMixto({ pedido, onFijado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [montos, setMontos] = useState<Record<MetodoArqueo, string>>(() => {
    const base: Record<MetodoArqueo, string> = { efectivo: '', debito: '', credito: '', transferencia: '', qr: '' }
    if (pedido.metodo_pago === 'mixto' && pedido.pago_mixto) {
      for (const m of METODOS_ARQUEO) if (pedido.pago_mixto[m]) base[m] = String(pedido.pago_mixto[m])
    } else if (pedido.metodo_pago && (METODOS_ARQUEO as readonly string[]).includes(pedido.metodo_pago)) {
      base[pedido.metodo_pago as MetodoArqueo] = String(pedido.total)
    }
    return base
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const suma = METODOS_ARQUEO.reduce((s, m) => s + (Number(montos[m]) || 0), 0)
  const falta = pedido.total - suma

  async function guardar() {
    setBusy(true)
    setError(null)
    try {
      const payload: Partial<Record<MetodoArqueo, number>> = {}
      for (const m of METODOS_ARQUEO) {
        const n = Number(montos[m]) || 0
        if (n > 0) payload[m] = n
      }
      await fijarPagoMixto(pedido.id, payload)
      setAbierto(false)
      onFijado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="btn-link" onClick={() => setAbierto(true)}>
        🔀 {pedido.metodo_pago === 'mixto' ? 'Corregir pago mixto' : 'Fue pago mixto'}
      </button>
    )
  }

  return (
    <div className="pago-mixto-form">
      <p className="subtitle">Reparte los {formatCLP(pedido.total)} entre los métodos que corresponda.</p>
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
        <button type="button" className="btn btn-primary btn-small" disabled={busy || falta !== 0} onClick={guardar}>
          {busy ? 'Guardando...' : 'Guardar reparto'}
        </button>
      </div>
    </div>
  )
}
