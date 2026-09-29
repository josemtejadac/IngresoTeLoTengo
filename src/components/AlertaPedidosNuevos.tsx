import { useCallback, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { useRealtimeRefresh } from '../lib/realtime'
import { loadPedidosTiendaPendientes } from '../lib/tienda'

interface Props {
  /** Lleva al trabajador a la pestaña Pedidos. */
  onVerPedidos: () => void
  /** Cantidad de pedidos por entregar, para la marca en la pestaña Pedidos. */
  onCantidad: (n: number) => void
}

interface Aviso {
  id: string
  tipo: 'nuevo' | 'cancelado'
  nombre: string
  total: number
}

// Se crea una sola vez y se reutiliza: en iOS/Safari un AudioContext nuevo arranca "suspended" y
// solo se puede reanudar (no crear) fuera de un toque del usuario. Por eso se deja uno vivo y se
// intenta "desbloquear" con el primer toque en la pantalla.
let audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!audioCtx) audioCtx = new Ctx()
    return audioCtx
  } catch {
    return null
  }
}
if (typeof window !== 'undefined') {
  const desbloquear = () => {
    getAudioCtx()?.resume().catch(() => {})
  }
  window.addEventListener('pointerdown', desbloquear, { passive: true })
  window.addEventListener('touchstart', desbloquear, { passive: true })
}

/** Sonido bien audible para llamar la atencion: campanita de 3 tonos, repetida dos veces, mas vibracion fuerte. */
function pitar() {
  try {
    const ctx = getAudioCtx()
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {})
      const notas = [988, 1319, 1568] // Si - Mi - Sol, campanita clara y alegre
      const repeticiones = 2
      for (let r = 0; r < repeticiones; r++) {
        notas.forEach((freq, i) => {
          const inicio = ctx.currentTime + r * 0.75 + i * 0.16
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.value = freq
          // Envolvente (ataque rapido, caida suave) para que no suene un click seco, y bien fuerte.
          gain.gain.setValueAtTime(0, inicio)
          gain.gain.linearRampToValueAtTime(0.5, inicio + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.001, inicio + 0.35)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(inicio)
          osc.stop(inicio + 0.36)
        })
      }
    }
  } catch {
    // sin audio disponible
  }
  try {
    navigator.vibrate?.([250, 100, 250, 100, 250])
  } catch {
    // sin vibracion
  }
}

/**
 * Avisa cuando llega un pedido nuevo de la tienda (o uno online queda pagado) y cuando un cliente cancela.
 * Compara la lista de pedidos por entregar contra la anterior: asi el aviso llega aunque el celular haya
 * perdido la conexion en vivo un rato (se pone al dia al volver a la app o cada 15 s).
 */
export function AlertaPedidosNuevos({ onVerPedidos, onCantidad }: Props) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const onCantidadRef = useRef(onCantidad)
  onCantidadRef.current = onCantidad
  // Pedidos por entregar que ya conociamos (null = aun no se cargo la primera vez: no se avisa por los que ya estaban).
  const vistos = useRef<Map<string, { nombre: string; total: number }> | null>(null)

  const revisar = useCallback(async () => {
    try {
      const rows = (await loadPedidosTiendaPendientes()).filter((p) => p.estado === 'pendiente')
      onCantidadRef.current(rows.length)
      const nuevoMapa = new Map(rows.map((p) => [p.id, { nombre: p.nombre_cliente, total: Number(p.total) }]))
      const previo = vistos.current
      vistos.current = nuevoMapa
      if (!previo) return

      const llegaron: Aviso[] = rows
        .filter((p) => !previo.has(p.id))
        .map((p) => ({ id: p.id, tipo: 'nuevo' as const, nombre: p.nombre_cliente, total: Number(p.total) }))

      // Los que estaban y ya no: se mira si el cliente los cancelo (los entregados no se avisan).
      const desaparecidos = [...previo.keys()].filter((id) => !nuevoMapa.has(id))
      let cancelados: Aviso[] = []
      if (desaparecidos.length > 0) {
        const { data } = await supabase
          .from('ingreso_pedidos_tienda')
          .select('id, nombre_cliente, total')
          .in('id', desaparecidos)
          .eq('estado', 'cancelado')
          .eq('cancelado_por_cliente', true)
        cancelados = ((data as { id: string; nombre_cliente: string; total: number }[]) ?? []).map((p) => ({
          id: p.id,
          tipo: 'cancelado' as const,
          nombre: p.nombre_cliente,
          total: Number(p.total),
        }))
      }

      if (llegaron.length > 0 || cancelados.length > 0) {
        pitar()
        setAvisos((prev) => [
          ...prev.filter((a) => ![...llegaron, ...cancelados].some((n) => n.id === a.id)),
          ...llegaron,
          ...cancelados,
        ])
      }
    } catch {
      // se reintenta en la proxima revision
    }
  }, [])

  // Tiempo real + al volver a la app + respaldo cada 15 segundos.
  useRealtimeRefresh(['ingreso_pedidos_tienda'], revisar, 15000)

  if (avisos.length === 0) return null

  const nuevos = avisos.filter((a) => a.tipo === 'nuevo')
  const cancelados = avisos.filter((a) => a.tipo === 'cancelado')

  return (
    <div className="alerta-pedidos" role="alert">
      <div className="alerta-pedidos-texto">
        {nuevos.length > 0 && (
          <div>
            🔔 <strong>{nuevos.length === 1 ? '¡Nuevo pedido!' : `¡${nuevos.length} pedidos nuevos!`}</strong>{' '}
            {nuevos.length === 1 ? `${nuevos[0].nombre} · ${formatCLP(nuevos[0].total)}` : 'Revisa la lista de pedidos.'}
          </div>
        )}
        {cancelados.map((c) => (
          <div key={c.id}>
            ❌ <strong>Cancelado por el cliente:</strong> {c.nombre} · {formatCLP(c.total)}
          </div>
        ))}
      </div>
      <button
        className="btn btn-primary btn-small"
        onClick={() => {
          setAvisos([])
          onVerPedidos()
        }}
      >
        Ver pedidos
      </button>
      <button className="alerta-cerrar" aria-label="Cerrar aviso" onClick={() => setAvisos([])}>
        ✕
      </button>
    </div>
  )
}
