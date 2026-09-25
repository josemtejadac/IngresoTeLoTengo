import { useEffect, useRef, useState } from 'react'

export interface ItemBot {
  producto_id: string
  cantidad?: number
  gramos?: number
}

interface Mensaje {
  role: 'user' | 'model'
  text: string
  items?: ItemBot[]
  agregado?: boolean
}

interface Props {
  /** Hay productos en el carrito: el boton sube para no quedar tapado por la barra del carrito. */
  hayCarrito: boolean
  /** Agrega al carrito los productos que armo el bot. */
  onAgregar: (items: ItemBot[]) => Promise<void>
  onVerCarrito: () => void
}

const SALUDO: Mensaje = { role: 'model', text: '¡Hola vecino! 👋 Soy BotsitoMarket. ¿En qué puedo ayudarte?' }
const SUGERENCIAS = ['Quiero armar un pedido', '¿Cómo puedo pagar?', '¿Cómo funciona el delivery?']
const EXPIRA_MS = 5 * 60 * 1000

/** Asistente de la tienda para clientes: responde dudas y arma el pedido con lo que pidan. */
export function BotsitoCliente({ hayCarrito, onAgregar, onVerCarrito }: Props) {
  const [open, setOpen] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([SALUDO])
  const [pregunta, setPregunta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)

  // La conversacion se borra sola a los 5 minutos sin actividad.
  useEffect(() => {
    if (mensajes.length <= 1) return
    const t = setTimeout(() => {
      setMensajes([SALUDO])
      setError(null)
    }, EXPIRA_MS)
    return () => clearTimeout(t)
  }, [mensajes])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [mensajes, busy, open])

  async function enviar(texto: string) {
    const question = texto.trim()
    if (!question || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setPregunta('')
    const history = mensajes.slice(1).map((m) => ({ role: m.role, text: m.text }))
    setMensajes((prev) => [...prev, { role: 'user', text: question }])
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingreso-chat-cliente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'No pude responder ahora')
      setMensajes((prev) => [...prev, { role: 'model', text: body.answer, items: body.items ?? [] }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pude responder ahora')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function agregar(idx: number) {
    const m = mensajes[idx]
    if (!m.items || m.items.length === 0 || m.agregado) return
    try {
      await onAgregar(m.items)
      setMensajes((prev) => prev.map((x, i) => (i === idx ? { ...x, agregado: true } : x)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pude agregarlo al carrito')
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={hayCarrito ? 'chat-fab chat-fab-alto' : 'chat-fab'}
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
        <button type="button" className="chat-close" onClick={() => setOpen(false)} aria-label="Cerrar">
          ✕
        </button>
      </div>

      <div className="chat-list" ref={listRef}>
        {mensajes.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'chat-msg chat-user' : 'chat-msg chat-bot'}>
            {m.text}
            {m.items && m.items.length > 0 && (
              <div className="chat-acciones">
                {m.agregado ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => {
                      setOpen(false)
                      onVerCarrito()
                    }}
                  >
                    ✔ Agregado · Ver mi carrito
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-small" onClick={() => agregar(i)}>
                    🛒 Agregar al carrito ({m.items.length})
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {mensajes.length === 1 &&
          SUGERENCIAS.map((s) => (
            <button key={s} className="btn btn-secondary btn-small" onClick={() => enviar(s)}>
              {s}
            </button>
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
          maxLength={400}
          placeholder="Ej: quiero una coca cola de 1.5l"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !pregunta.trim()}>
          Enviar
        </button>
      </form>
    </div>
  )
}
