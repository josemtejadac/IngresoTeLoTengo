import { useEffect, useState } from 'react'
import { loadDatosTransferencia, saveDatosTransferencia } from '../lib/tienda'

export function DatosTransferenciaAdmin() {
  const [valor, setValor] = useState('')
  const [guardado, setGuardado] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadDatosTransferencia().then(setValor).catch(() => {})
  }, [])

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setGuardado(false)
    try {
      await saveDatosTransferencia(valor.trim())
      setGuardado(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error guardando los datos')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Datos para transferencias</h2>
      <p className="subtitle">
        Esto le aparece al cliente cuando elige pagar por transferencia (banco, tipo de cuenta,
        número, nombre, RUT y correo).
      </p>
      <form onSubmit={handleGuardar} className="worker-form">
        <label>
          Datos de la cuenta
          <textarea
            value={valor}
            onChange={(e) => {
              setValor(e.target.value)
              setGuardado(false)
            }}
            rows={6}
            placeholder={'Banco: ...\nTipo de cuenta: ...\nN° de cuenta: ...\nNombre: ...\nRUT: ...\nCorreo: ...'}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        {guardado && <p className="info-text">Guardado.</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Guardando...' : 'Guardar'}
        </button>
      </form>
    </section>
  )
}
