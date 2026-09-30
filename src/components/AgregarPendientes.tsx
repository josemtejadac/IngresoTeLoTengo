import { useRef, useState } from 'react'
import { ClienteSugerido, type ClienteOpcion } from './ClienteSugerido'
import {
  ElegirProductosPendiente,
  lineasAItems,
  lineasATextoResumen,
  totalLineaFiado,
  type LineaFiado,
} from './ElegirProductosPendiente'
import { addPendientes, agruparPorCliente, clienteNombre, fiarProductos, type PendienteEntry } from '../lib/pendientes'
import { formatCLP } from '../lib/payroll'

interface Row {
  cliente: string
  detalle: string
  monto: string
  /** Si se eligieron productos del inventario, el monto y detalle salen de acá (y se descuenta el stock). */
  lineas: LineaFiado[]
}

function filaVacia(): Row {
  return { cliente: '', detalle: '', monto: '', lineas: [] }
}

interface Props {
  workerId: string
  pendientes: PendienteEntry[]
  onGuardado: () => void
}

/** Formulario para registrar deudas (fiado) de clientes; usado por trabajadores y admin. */
export function AgregarPendientes({ workerId, pendientes, onGuardado }: Props) {
  const busyRef = useRef(false)
  const [rows, setRows] = useState<Row[]>([filaVacia()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [eligiendoProductosIdx, setEligiendoProductosIdx] = useState<number | null>(null)

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

  function quitarProductos(i: number) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, lineas: [] } : r)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busyRef.current) return

    const conProductos = rows.filter((r) => r.lineas.length > 0)
    const sinProductos = rows.filter((r) => r.lineas.length === 0 && (r.monto.trim() || r.cliente.trim()))

    if (conProductos.some((r) => !r.cliente.trim())) {
      setError('Cada deuda necesita el nombre del cliente.')
      return
    }
    const parsedManual = sinProductos.map((r) => ({
      monto: Number(r.monto),
      cliente: canonico(r.cliente.trim()),
      detalle: r.detalle.trim(),
    }))
    if (parsedManual.some((r) => !r.monto || r.monto <= 0 || !r.cliente)) {
      setError('Cada deuda necesita el nombre del cliente y un monto válido.')
      return
    }
    if (conProductos.length === 0 && parsedManual.length === 0) {
      setError('Cada deuda necesita el nombre del cliente y un monto válido (o productos elegidos).')
      return
    }

    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      for (const r of conProductos) {
        await fiarProductos(canonico(r.cliente.trim()), r.detalle.trim(), lineasAItems(r.lineas))
      }
      if (parsedManual.length > 0) await addPendientes(workerId, parsedManual)
      setRows([filaVacia()])
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
          {r.lineas.length > 0 ? (
            <div className="chat-input">
              <span className="campo-etiqueta">Productos (descuentan stock)</span>
              <p className="subtitle">
                {lineasATextoResumen(r.lineas)} · {formatCLP(r.lineas.reduce((sum, l) => sum + totalLineaFiado(l), 0))}
              </p>
              <div className="report-row">
                <button type="button" className="btn-link" onClick={() => setEligiendoProductosIdx(i)}>
                  Cambiar
                </button>
                <button type="button" className="btn-link" onClick={() => quitarProductos(i)}>
                  Quitar productos
                </button>
              </div>
            </div>
          ) : (
            <>
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
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setEligiendoProductosIdx(i)}>
                🛒 Elegir productos
              </button>
            </>
          )}
          {rows.length > 1 && (
            <button type="button" className="btn-link" onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}>
              Quitar
            </button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setRows((prev) => [...prev, filaVacia()])}>
        + Agregar otro cliente
      </button>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'Guardando...' : rows.length > 1 ? 'Registrar pendientes' : 'Registrar pendiente'}
      </button>

      {eligiendoProductosIdx !== null && (
        <ElegirProductosPendiente
          inicial={rows[eligiendoProductosIdx]?.lineas ?? []}
          onConfirmar={(lineas) => {
            setRows((prev) => prev.map((r, idx) => (idx === eligiendoProductosIdx ? { ...r, lineas } : r)))
            setEligiendoProductosIdx(null)
          }}
          onCancelar={() => setEligiendoProductosIdx(null)}
        />
      )}
    </form>
  )
}
