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
  if (!pushSoportado()) throw new Error('Este navegador no soporta notificaciones (prueba con Chrome).')

  // Si ya estaba bloqueado de antes, el navegador ni siquiera muestra el cuadro para pedir permiso.
  if (Notification.permission === 'denied') {
    throw new Error(
      'Las notificaciones están bloqueadas para esta página. Actívalas desde el candado 🔒 o los permisos del sitio, en el navegador, y vuelve a intentar.',
    )
  }

  const permiso = await Notification.requestPermission()
  if (permiso !== 'granted') {
    throw new Error(`No quedaron permitidas (el navegador respondió "${permiso}"). Vuelve a intentar y toca Permitir.`)
  }

  let reg: ServiceWorkerRegistration
  try {
    reg = await navigator.serviceWorker.ready
  } catch {
    throw new Error('La app todavía no terminó de instalarse en este navegador. Recarga la página y vuelve a intentar.')
  }

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      })
    } catch (err) {
      // En ventanas privadas/incognito muchos navegadores no permiten suscripciones push.
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`No se pudo activar en este navegador (${msg}). Prueba fuera de una ventana privada/incógnito.`)
    }
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
