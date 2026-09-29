import { useRef, useState } from 'react'
import { ClienteSugerido, type ClienteOpcion } from './ClienteSugerido'
import { addPendientes, agruparPorCliente, clienteNombre, type PendienteEntry } from '../lib/pendientes'

interface Props {
  workerId: string
  pendientes: PendienteEntry[]
  onGuardado: () => void
}

/** Formulario para registrar deudas (fiado) de clientes; usado por trabajadores y admin. */
export function AgregarPendientes({ workerId, pendientes, onGuardado }: Props) {
  const busyRef = useRef(false)
  const [rows, setRows] = useState([{ cliente: '', detalle: '', monto: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Todos los clientes que alguna vez tuvieron deuda (con o sin deuda hoy), para sugerirlos al escribir.
  const clientesConocidos: ClienteOpcion[] = (() => {
    const deudaPorClave = new Map(agruparPorCliente(pendientes).map((g) => [g.key, g.total]))
    const vistos = new Map<string, ClienteOpcion>()
    for (const p of pendientes) {
      const nombre = clienteNombre(p)
      const clave = nombre.toLowerCase().replace(/\s+/g, ' ')
      if (!vistos.has(clave)) vistos.set(clave, { nombre, deuda: deudaPorClave.get(clave) ?? 0 })
    }
    return [...vistos.values()]
  })()

  /** Si el nombre coincide con uno ya registrado (sin importar mayusculas/tildes), usa esa escritura. */
  function canonico(nombre: string): string {
    const norm = (t: string) =>
      t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const igual = clientesConocidos.find((c) => norm(c.nombre) === norm(nombre))
    return igual ? igual.nombre : nombre
  }

  function updateRow(i: number, field: 'cliente' | 'detalle' | 'monto', value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    const filled = rows.filter((r) => r.monto.trim() || r.cliente.trim())
    const parsed = filled.map((r) => ({
      monto: Number(r.monto),
      cliente: canonico(r.cliente.trim()),
      detalle: r.detalle.trim(),
    }))
    if (parsed.length === 0 || parsed.some((r) => !r.monto || r.monto <= 0 || !r.cliente)) {
      setError('Cada deuda necesita el nombre del cliente y un monto válido.')
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      await addPendientes(workerId, parsed)
      setRows([{ cliente: '', detalle: '', monto: '' }])
      onGuardado()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error registrando el pendiente')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="worker-form">
      {rows.map((r, i) => (
        <div key={i} className="report-row">
          <div className="chat-input">
            <span className="campo-etiqueta">Cliente</span>
            <ClienteSugerido
              value={r.cliente}
              onChange={(v) => updateRow(i, 'cliente', v)}
              opciones={clientesConocidos}
              placeholder="Ej: Juan, depto 202"
            />
          </div>
          <label className="chat-input">
            Detalle (opcional)
            <input
              value={r.detalle}
              onChange={(e) => updateRow(i, 'detalle', e.target.value)}
              placeholder="Ej: 2 Coca-Cola y pan"
            />
          </label>
          <label>
            Monto
            <input type="number" min={0} value={r.monto} onChange={(e) => updateRow(i, 'monto', e.target.value)} />
          </label>
          {rows.length > 1 && (
            <button type="button" className="btn-link" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}>
              Quitar
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setRows((prev) => [...prev, { cliente: '', detalle: '', monto: '' }])}>
        + Agregar otro cliente
      </button>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Guardando...' : rows.length > 1 ? 'Registrar pendientes' : 'Registrar pendiente'}
      </button>
    </form>
  )
}
