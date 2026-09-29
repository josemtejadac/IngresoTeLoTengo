import { supabase } from './supabase'

// Clave publica VAPID (no es secreta: el navegador la necesita para suscribirse).
const VAPID_PUBLIC_KEY = 'BBhI39b1yKYVqRKOMAhGcNmMCXX0JrWWgrLKh6C8TyCQgSGp8pDn3cwFXLtJg6OyqXdJd6i-OGZ8xCKrr8sxAIM'

export function pushSoportado(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export async function estadoNotificaciones(): Promise<'activadas' | 'desactivadas' | 'bloqueadas' | 'no_soportado'> {
  if (!pushSoportado()) return 'no_soportado'
  if (Notification.permission === 'denied') return 'bloqueadas'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  return sub ? 'activadas' : 'desactivadas'
}

/** Pide permiso (si hace falta) y guarda la suscripcion de este dispositivo para el trabajador logueado. */
export async function activarNotificaciones() {
  if (!pushSoportado()) throw new Error('Este navegador no soporta notificaciones.')
  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') throw new Error('No diste permiso para las notificaciones.')

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
  }
  const json = sub.toJSON()
  const { error } = await supabase.rpc('ingreso_push_suscribir', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
  })
  if (error) throw error
}

/** Apaga las notificaciones en este dispositivo (no afecta a otros trabajadores ni a otros dispositivos). */
export async function desactivarNotificaciones() {
  if (!pushSoportado()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe()
  await supabase.rpc('ingreso_push_desuscribir', { p_endpoint: endpoint })
}
