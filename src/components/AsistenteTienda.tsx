import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Mensaje {
  role: 'user' | 'model'
  text: string
}

const SUGERENCIAS = [
  '¿Cuáles son los productos más vendidos?',
  '¿Qué productos se venden menos?',
  '¿Cómo armo un pedido?',
  '¿Cómo funciona el arqueo?',
]

export function AsistenteTienda() {
  const [days, setDays] = useState(30)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [pregunta, setPregunta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)

  async function enviar(texto: string) {
    const question = texto.trim()
    if (!question || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setPregunta('')
    const history = mensajes
    setMensajes([...history, { role: 'user', text: question }])
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingreso-chat-tienda`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ question, days, history }),
        },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Error consultando al asistente')
      setMensajes((prev) => [...prev, { role: 'model', text: body.answer }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error consultando al asistente')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2>Asistente</h2>
        <label>
          Período de ventas
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>Última semana</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
        </label>
      </div>
      <p className="subtitle">
        Pregunta por las ventas y productos de la tienda, o cómo usar la app.
      </p>

      {mensajes.length === 0 && (
        <div className="action-row">
          {SUGERENCIAS.map((s) => (
            <button key={s} className="btn btn-secondary btn-small" onClick={() => enviar(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="chat-list">
        {mensajes.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-msg chat-user' : 'chat-msg chat-bot'}>
            {m.text}
          </div>
        ))}
        {busy && <div className="chat-msg chat-bot">Pensando...</div>}
      </div>
      {error && <p className="error-text">{error}</p>}

      <form
        className="report-row"
        onSubmit={(e) => {
          e.preventDefault()
          enviar(pregunta)
        }}
      >
        <label className="chat-input">
          Tu pregunta
          <input value={pregunta} onChange={(e) => setPregunta(e.target.value)} maxLength={600} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={busy || !pregunta.trim()}>
          Enviar
        </button>
      </form>
    </section>
  )
}
