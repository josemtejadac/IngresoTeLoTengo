import { supabase } from './supabase'
import { pushSoportado } from './pushNotificaciones'

// Misma clave publica VAPID que usa el personal; el cliente no inicia sesion, asi que la suscripcion
// queda atada al pedido (el id del pedido ya es el "secreto" que el cliente tiene en su navegador).
const VAPID_PUBLIC_KEY = 'BBhI39b1yKYVqRKOMAhGcNmMCXX0JrWWgrLKh6C8TyCQgSGp8pDn3cwFXLtJg6OyqXdJd6i-OGZ8xCKrr8sxAIM'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export { pushSoportado }

export async function estadoNotificacionesCliente(): Promise<'activadas' | 'desactivadas' | 'bloqueadas' | 'no_soportado'> {
  if (!pushSoportado()) return 'no_soportado'
  if (Notification.permission === 'denied') return 'bloqueadas'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'activadas' : 'desactivadas'
}

/** Activa avisos de este dispositivo para el progreso de UN pedido puntual (no requiere cuenta). */
export async function activarNotificacionesCliente(pedidoId: string) {
  if (!pushSoportado()) throw new Error('Este navegador no soporta notificaciones (prueba con Chrome).')
  if (Notification.permission === 'denied') {
    throw new Error('Las notificaciones están bloqueadas para esta página. Actívalas desde el candado 🔒 del navegador.')
  }
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    throw new Error(`No quedaron permitidas (el navegador respondió "${permiso}").`)
  }
  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.ready
  } catch {
    throw new Error('La página todavía no terminó de cargar. Recarga y vuelve a intentar.')
  }
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`No se pudo activar (${msg}). Prueba fuera de una ventana privada/incógnito.`)
    }
  }
  const json = sub.toJSON()
  const { error } = await supabase.rpc('ingreso_push_suscribir_cliente', {
    p_pedido: pedidoId,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  })
  if (error) throw error
}

export async function desactivarNotificacionesCliente() {
  if (!pushSoportado()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await supabase.rpc('ingreso_push_desuscribir_cliente', { p_endpoint: endpoint })
}
