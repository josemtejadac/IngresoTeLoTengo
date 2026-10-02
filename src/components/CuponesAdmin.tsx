import { useCallback, useEffect, useState } from 'react'
import { crearCupon, desactivarCupon, loadCupones, type Cupon } from '../lib/tienda'

export function CuponesAdmin() {
  const [cupones, setCupones] = useState<Cupon[]>([])
  const [error, setError] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [descuento, setDescuento] = useState('20')
  const [duracionDias, setDuracionDias] = useState('')
  const [usoUnico, setUsoUnico] = useState(true)
  const [usosMaximos, setUsosMaximos] = useState('')
  const [busy, setBusy] = useState(false)

  const cargar = useCallback(async () => {
    try {
      setCupones(await loadCupones())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error cargando los cupones')
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault()
    if (!codigo.trim() || !descuento) return
    setBusy(true)
    setError(null)
    try {
      let vence: string | undefined
      if (duracionDias.trim()) {
        const dias = Number(duracionDias)
        const fecha = new Date()
        fecha.setDate(fecha.getDate() + dias)
        vence = fecha.toISOString().slice(0, 10)
      }
      const maxUsos = usoUnico ? 1 : usosMaximos ? Number(usosMaximos) : undefined
      await crearCupon(codigo, Number(descuento), vence, maxUsos)
      setCodigo('')
      setDescuento('20')
      setDuracionDias('')
      setUsosMaximos('')
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creando el cupón')
    } finally {
      setBusy(false)
    }
  }

  async function handleDesactivar(c: Cupon) {
    if (!window.confirm(`¿Desactivar el cupón ${c.codigo}? Ya no se podrá usar.`)) return
    try {
      await desactivarCupon(c.id)
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desactivando el cupón')
    }
  }

  function vigencia(c: Cupon): { texto: string; clase: string } {
    if (!c.activo) return { texto: 'Desactivado', clase: 'cupon-estado-apagado' }
    if (c.vence_at && new Date(c.vence_at) < new Date()) return { texto: 'Vencido', clase: 'cupon-estado-apagado' }
    if (c.usos_maximos !== null && c.usos_actuales >= c.usos_maximos) {
      return { texto: 'Usos agotados', clase: 'cupon-estado-apagado' }
    }
    return { texto: 'Vigente', clase: 'cupon-estado-vigente' }
  }

  return (
    <section className="card">
      <h2>Cupones de descuento</h2>
      <p className="subtitle">
        1️⃣ Crea el código aquí abajo. 2️⃣ Baja a "Seguimiento de clientes" y elige a quién mandárselo: puedes
        mandarlo dentro de la app (le aparece solo en la tienda) o por WhatsApp. El cliente lo escribe en el
        checkout y el descuento se aplica solo sobre el total del pedido.
      </p>
      <form onSubmit={handleCrear} className="worker-form">
        <label>
          Código (ej. BIENVENIDO20)
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            placeholder="BIENVENIDO20"
          />
        </label>
        <label>
          Descuento (%)
          <input type="number" min={1} max={90} value={descuento} onChange={(e) => setDescuento(e.target.value)} />
        </label>
        <label>
          Dura cuántos días (opcional)
          <input
            type="number"
            min={1}
            value={duracionDias}
            onChange={(e) => setDuracionDias(e.target.value)}
            placeholder="Sin vencimiento"
          />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={usoUnico} onChange={(e) => setUsoUnico(e.target.checked)} />
          Uso único (el cupón se gasta en el primer pedido que lo use)
        </label>
        {!usoUnico && (
          <label>
            Máximo de usos (opcional)
            <input
              type="number"
              min={1}
              value={usosMaximos}
              onChange={(e) => setUsosMaximos(e.target.value)}
              placeholder="Sin límite"
            />
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Creando...' : 'Crear cupón'}
        </button>
      </form>

      {cupones.length === 0 ? (
        <p className="subtitle">Todavía no has creado ningún cupón.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Descuento</th>
              <th>Estado</th>
              <th>Usos</th>
              <th>Vence</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cupones.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.codigo}</strong>
                </td>
                <td>{c.descuento_pct}%</td>
                <td>
                  <span className={`cupon-estado ${vigencia(c).clase}`}>{vigencia(c).texto}</span>
                </td>
                <td>
                  {c.usos_actuales}
                  {c.usos_maximos !== null ? ` / ${c.usos_maximos}` : ''}
                </td>
                <td>{c.vence_at ? new Date(c.vence_at).toLocaleDateString('es-CL') : 'Sin fecha'}</td>
                <td>
                  {c.activo && (
                    <button type="button" className="btn btn-danger-outline btn-small" onClick={() => handleDesactivar(c)}>
                      Desactivar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
