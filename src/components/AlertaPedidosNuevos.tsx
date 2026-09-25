import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCLP } from '../lib/payroll'
import { loadPedidosTiendaPendientes, type PedidoTienda } from '../lib/tienda'

interface Props {
  /** Lleva al trabajador a la pestaña Pedidos. */
  onVerPedidos: () => void
  /** Cantidad de pedidos por entregar, para la marca en la pestaña Pedidos. */
  onCantidad: (n: number) => void
}

interface Aviso {
  id: string
  nombre: string
  total: number
}

/** Pitido corto para llamar la atencion (puede fallar si el navegador aun no permite audio: no es grave). */
function pitar() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    ;[880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      gain.gain.value = 0.15
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + i * 0.2)
      osc.stop(ctx.currentTime + i * 0.2 + 0.15)
    })
    setTimeout(() => ctx.close(), 800)
  } catch {
    // sin audio disponible
  }
  try {
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // sin vibracion
  }
}

/**
 * Avisa en tiempo real cuando llega un pedido nuevo de la tienda (o uno online queda pagado):
 * aviso arriba con sonido y vibracion, y cantidad de pendientes en la pestaña Pedidos.
 */
export function AlertaPedidosNuevos({ onVerPedidos, onCantidad }: Props) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const onCantidadRef = useRef(onCantidad)
  onCantidadRef.current = onCantidad

  const contar = useCallback(async () => {
    try {
      const rows = await loadPedidosTiendaPendientes()
      onCantidadRef.current(rows.filter((p) => p.estado === 'pendiente').length)
    } catch {
      // se reintenta en el proximo cambio
    }
  }, [])

  useEffect(() => {
    contar()
    const canal = supabase
      .channel(`alerta_pedidos_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingreso_pedidos_tienda' }, (payload) => {
        contar()
        const nuevo = payload.new as Partial<PedidoTienda>
        const viejo = payload.old as Partial<PedidoTienda>
        const esNuevoContraEntrega =
          payload.eventType === 'INSERT' && nuevo.metodo_pago !== 'online' && nuevo.estado === 'pendiente'
        const onlineRecienPagado =
          payload.eventType === 'UPDATE' &&
          nuevo.metodo_pago === 'online' &&
          nuevo.pago_estado === 'pagado' &&
          nuevo.estado === 'pendiente' &&
          viejo.pago_estado !== 'pagado'
        if ((esNuevoContraEntrega || onlineRecienPagado) && nuevo.id) {
          pitar()
          setAvisos((prev) => [
            ...prev.filter((a) => a.id !== nuevo.id),
            { id: nuevo.id as string, nombre: nuevo.nombre_cliente ?? 'Cliente', total: Number(nuevo.total ?? 0) },
          ])
        }
      })
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [contar])

  if (avisos.length === 0) return null

  return (
    <div className="alerta-pedidos" role="alert">
      <div className="alerta-pedidos-texto">
        🔔 <strong>{avisos.length === 1 ? '¡Nuevo pedido!' : `¡${avisos.length} pedidos nuevos!`}</strong>{' '}
        {avisos.length === 1 ? `${avisos[0].nombre} · ${formatCLP(avisos[0].total)}` : 'Revisa la lista de pedidos.'}
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
