/**
 * Registra el service worker y se asegura de que la app se ponga al dia sola cuando hay una version nueva.
 * El registro por defecto de vite-plugin-pwa solo instala el service worker una vez y no vuelve a revisar
 * si hay algo nuevo: si alguien deja la app abierta sin cerrarla del todo (lo normal en una PWA instalada),
 * puede quedar viendo una version vieja por dias. Por eso aca se revisa seguido y se recarga sola cuando
 * hay una version nueva lista.
 */
export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    // Cuando el nuevo service worker toma el control, la version vieja del codigo ya no sirve: se recarga sola.
    let yaRecargo = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (yaRecargo) return
      yaRecargo = true
      window.location.reload()
    })

    // Revisa si hay una version nueva: al volver a la pestaña/app y cada 5 minutos mientras esta abierta.
    const revisar = () => reg.update().catch(() => {})
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar()
    })
    window.addEventListener('focus', revisar)
    setInterval(revisar, 5 * 60 * 1000)
  })
}
