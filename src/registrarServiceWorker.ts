/**
 * Registra el service worker y se asegura de que la app se ponga al dia sola cuando hay una version nueva.
 * El service worker generado por Workbox NO se activa solo cuando encuentra una version nueva: se queda
 * "esperando" hasta que alguien le mande el mensaje SKIP_WAITING (asi evita cambiarle el codigo a una pestaña
 * a medio uso). Si nadie manda ese mensaje, la version nueva queda instalada pero nunca toma el control, y el
 * cliente sigue viendo la version vieja indefinidamente (en la practica, hasta cerrar la PWA del todo, algo
 * que casi nadie hace en el celular). Por eso aca se revisa seguido si hay una version nueva Y se le manda el
 * aviso para que se active de inmediato, en vez de esperar.
 */
export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

    // Si un service worker nuevo ya esta instalado y esperando, se activa ya mismo.
    function activarSiHayUnoEsperando() {
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
    }

    // Cuando el nuevo service worker toma el control, la version vieja del codigo ya no sirve: se recarga sola.
    let yaRecargo = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (yaRecargo) return
      yaRecargo = true
      window.location.reload()
    })

    // Si encuentra una version nueva mientras esta pestaña esta abierta, apenas termine de instalarse se activa.
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing
      if (!nuevo) return
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed') activarSiHayUnoEsperando()
      })
    })

    activarSiHayUnoEsperando()

    // Revisa si hay una version nueva: al volver a la pestaña/app y cada 5 minutos mientras esta abierta.
    const revisar = () => {
      activarSiHayUnoEsperando()
      reg.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar()
    })
    window.addEventListener('focus', revisar)
    setInterval(revisar, 5 * 60 * 1000)
  })
}
