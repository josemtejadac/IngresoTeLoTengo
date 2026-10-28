/**
 * Registra el service worker y se asegura de que la app se ponga al dia sola cuando hay una version nueva.
 * El service worker generado por Workbox NO se activa solo cuando encuentra una version nueva: se queda
 * "esperando" hasta que alguien le mande el mensaje SKIP_WAITING (asi evita cambiarle el codigo a una pestaña
 * a medio uso). Si nadie manda ese mensaje, la version nueva queda instalada pero nunca toma el control, y el
 * cliente sigue viendo la version vieja indefinidamente (en la practica, hasta cerrar la PWA del todo, algo
 * que casi nadie hace en el celular). Por eso aca se revisa seguido si hay una version nueva Y se le manda el
 * aviso para que se active de inmediato, en vez de esperar.
 */
// Una version nueva recarga la pagina al instante (el carrito y los datos guardados en el telefono no se borran).
// Solo si el cliente esta llenando el pedido se espera a que lo envie o lo cierre, para no borrarle lo que escribia.
// Antes de recargar se avisa con el evento EVENTO_ANTES_DE_RECARGAR para que la pagina guarde donde estaba.
export const EVENTO_ANTES_DE_RECARGAR = 'tlt-antes-de-recargar'

let ocupado = false
let recargaPendiente = false

function recargar() {
  window.dispatchEvent(new Event(EVENTO_ANTES_DE_RECARGAR))
  window.location.reload()
}

export function avisarOcupado(valor: boolean) {
  ocupado = valor
  if (!valor && recargaPendiente) {
    recargaPendiente = false
    recargar()
  }
}

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
      if (!ocupado) {
        recargar()
        return
      }
      recargaPendiente = true
      // Si sale de la app con el pedido a medio llenar, se recarga ahi (lo que ya escribio queda en pantalla al volver
      // solo si el navegador conserva la pagina; el carrito siempre queda guardado).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && recargaPendiente) {
          recargaPendiente = false
          recargar()
        }
      })
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

    // Revisa si hay una version nueva: al volver a la pestaña/app y cada 2 minutos mientras esta abierta.
    const revisar = () => {
      activarSiHayUnoEsperando()
      reg.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar()
    })
    window.addEventListener('focus', revisar)
    setInterval(revisar, 2 * 60 * 1000)
  })
}
