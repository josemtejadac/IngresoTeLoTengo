import { useEffect, useRef, useState } from 'react'
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

const EXPIRA_MS = 5 * 60 * 1000

export function AsistenteTienda() {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(30)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [pregunta, setPregunta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  // El chat se borra solo a los 5 minutos de la ultima actividad.
  useEffect(() => {
    if (mensajes.length === 0) return
    const t = setTimeout(() => {
      setMensajes([])
      setError(null)
    }, EXPIRA_MS)
    return () => clearTimeout(t)
  }, [mensajes])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [mensajes, busy, open])

  function cerrar() {
    setOpen(false)
    setMensajes([])
    setError(null)
    setPregunta('')
  }

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

  if (!open) {
    return (
      <button
        type="button"
        className="chat-fab"
        onClick={() => setOpen(true)}
        aria-label="Abrir BotsitoMarket"
      >
        💬
      </button>
    )
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="BotsitoMarket">
      <div className="chat-header">
        <strong>BotsitoMarket</strong>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Período de ventas"
        >
          <option value={7}>7 días</option>
          <option value={30}>30 días</option>
          <option value={90}>90 días</option>
        </select>
        <button type="button" className="chat-close" onClick={cerrar} aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {mensajes.length === 0 && (
          <>
            <p className="subtitle">
              Pregunta por las ventas y productos, o cómo usar la app. El chat se borra a los 5
              minutos.
            </p>
            {SUGERENCIAS.map((s) => (
              <button key={s} className="btn btn-secondary btn-small" onClick={() => enviar(s)}>
                {s}
              </button>
            ))}
          </>
        )}
        {mensajes.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-msg chat-user' : 'chat-msg chat-bot'}>
            {m.text}
          </div>
        ))}
        {busy && <div className="chat-msg chat-bot">Pensando...</div>}
        {error && <p className="error-text">{error}</p>}
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          enviar(pregunta)
        }}
      >
        <input
          value={pregunta}
          onChange={(e) => setPregunta(e.target.value)}
          maxLength={600}
          placeholder="Escribe tu pregunta"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !pregunta.trim()}>
          Enviar
        </button>
      </form>
    </div>
  )
}
