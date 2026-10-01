import { useState } from 'react'
import { formatCLP } from '../lib/payroll'
import { submitArqueo, ventaTotal } from '../lib/arqueo'

interface Props {
  workerId: string
  /** Dia del arqueo en formato AAAA-MM-DD. */
  fecha: string
  /** Se llama al guardar, para refrescar las tablas. */
  onGuardado: () => void
}

/** Formulario de arqueo para el administrador (igual al de los trabajadores). */
export function RegistrarArqueo({ workerId, fecha, onGuardado }: Props) {
  const [abierto, setAbierto] = useState(false)
  const [efectivo, setEfectivo] = useState('')
  const [tarjeta, setTarjeta] = useState('')
  const [transferencia, setTransferencia] = useState('')
  const [qr, setQr] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const valores = {
    efectivo: Number(efectivo) || 0,
    tarjeta: Number(tarjeta) || 0,
    transferencia: Number(transferencia) || 0,
    qr: Number(qr) || 0,
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (Object.values(valores).some((v) => v < 0)) {
      setError('Los montos no pueden ser negativos.')
      return
    }
    setBusy(true)
    setError(null)
    setMensaje(null)
    try {
      await submitArqueo(workerId, fecha, valores)
      setEfectivo('')
      setTarjeta('')
      setTransferencia('')
      setQr('')
      setMensaje('Arqueo guardado correctamente.')
      onGuardado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando el arqueo')
    } finally {
      setBusy(false)
    }
  }

  if (!abierto) {
    return (
      <button className="btn btn-primary btn-small" onClick={() => setAbierto(true)}>
        + Registrar mi arqueo
      </button>
    )
  }

  return (
    <form className="worker-form" onSubmit={guardar}>
      <h3>Mi arqueo de hoy</h3>
      <div className="manual-datos">
        <label>
          Efectivo
          <input type="number" min={0} value={efectivo} onChange={(e) => setEfectivo(e.target.value)} />
        </label>
        <label>
          Tarjeta
          <input type="number" min={0} value={tarjeta} onChange={(e) => setTarjeta(e.target.value)} />
        </label>
        <label>
          Transferencia
          <input type="number" min={0} value={transferencia} onChange={(e) => setTransferencia(e.target.value)} />
        </label>
        <label>
          QR
          <input type="number" min={0} value={qr} onChange={(e) => setQr(e.target.value)} />
        </label>
      </div>
      <p>
        Venta total: <strong>{formatCLP(ventaTotal(valores))}</strong>
      </p>
      {error && <p className="error-text">{error}</p>}
      {mensaje && <p className="info-text">{mensaje}</p>}
      <div className="report-row">
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setAbierto(false)}>
          Cerrar
        </button>
        <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
          {busy ? 'Guardando...' : 'Guardar arqueo'}
        </button>
      </div>
    </form>
  )
}
