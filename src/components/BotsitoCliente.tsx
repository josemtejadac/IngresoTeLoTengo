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
const soportaVoz = typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof MediaRecorder !== 'undefined'

/** Asistente de la tienda para clientes: responde dudas y arma el pedido con lo que pidan. */
export function BotsitoCliente({ hayCarrito, onAgregar, onVerCarrito }: Props) {
  const [open, setOpen] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([SALUDO])
  const [pregunta, setPregunta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [grabando, setGrabando] = useState(false)
  const busyRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  /** Manda un audio grabado: la misma IA lo transcribe y arma el pedido igual que con texto. */
  async function enviarAudio(audioBase64: string, mimeType: string) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    const history = mensajes.slice(1).map((m) => ({ role: m.role, text: m.text }))
    // Se muestra un placeholder hasta saber que entendio la IA (el index queda fijo para reemplazarlo despues).
    let idxPlaceholder = -1
    setMensajes((prev) => {
      idxPlaceholder = prev.length
      return [...prev, { role: 'user', text: '🎤 Nota de voz...' }]
    })
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingreso-chat-cliente`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioBase64, mimeType, history }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'No pude entender el audio')
      const textoEntendido = body.transcript?.trim() || '🎤 Nota de voz'
      setMensajes((prev) =>
        prev.map((m, i) => (i === idxPlaceholder ? { ...m, text: textoEntendido } : m)).concat({
          role: 'model',
          text: body.answer,
          items: body.items ?? [],
        }),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pude entender el audio, intenta de nuevo o escribe')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = String(reader.result ?? '')
        // El data URL viene como "data:audio/webm;base64,AAAA...": solo se manda la parte de despues de la coma.
        resolve(result.slice(result.indexOf(',') + 1))
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  async function iniciarGrabacion() {
    if (grabando || busyRef.current) return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(
        (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t),
      )
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        if (autoStopRef.current) {
          clearTimeout(autoStopRef.current)
          autoStopRef.current = null
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size > 0) {
          const base64 = await blobToBase64(blob)
          enviarAudio(base64, blob.type || 'audio/webm')
        }
      }
      mediaRecorderRef.current = rec
      rec.start()
      setGrabando(true)
      // Tope de 25 seg por nota de voz: evita grabaciones gigantes o que alguien se olvide el microfono abierto.
      autoStopRef.current = setTimeout(() => detenerGrabacion(), 25000)
    } catch {
      setError('No pude acceder al micrófono. Revisa los permisos del navegador.')
    }
  }

  function detenerGrabacion() {
    setGrabando(false)
    mediaRecorderRef.current?.stop()
    mediaRecorderRef.current = null
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
        {busy && <div className="chat-msg chat-bot">{grabando ? 'Escuchando...' : 'Pensando...'}</div>}
        {error && <p className="error-text">{error}</p>}
      </div>

      {grabando ? (
        <div className="chat-form chat-form-grabando">
          <span className="chat-grabando-aviso">🔴 Grabando... toca para enviar (máx. 25 seg)</span>
          <button type="button" className="btn btn-primary" onClick={detenerGrabacion}>
            ⏹ Enviar nota de voz
          </button>
        </div>
      ) : (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault()
            enviar(pregunta)
          }}
        >
          {soportaVoz && (
            <button
              type="button"
              className="chat-mic-btn"
              onClick={iniciarGrabacion}
              disabled={busy}
              aria-label="Hablar por micrófono"
              title="Hablar por micrófono"
            >
              🎤
            </button>
          )}
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
      )}
    </div>
  )
}
