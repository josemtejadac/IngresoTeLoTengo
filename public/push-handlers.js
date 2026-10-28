// Se agrega al Service Worker generado (via workbox.importScripts) para que las notificaciones
// funcionen aunque la app este cerrada o el celular con la pantalla bloqueada.

self.addEventListener('push', (event) => {
  let datos = { titulo: 'Te Lo Tengo Market', texto: 'Tienes una novedad.' }
  try {
    if (event.data) datos = { ...datos, ...event.data.json() }
  } catch {
    // si el mensaje no viene en JSON, se usa el texto por defecto
  }
  event.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.texto,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'ingreso-pedido-' + Date.now(),
      renotify: true,
      // Sin esto, algunos navegadores muestran la notificacion muda: se fuerza sonido y vibracion.
      silent: false,
      vibrate: datos.urgente ? [300, 150, 300, 150, 300] : [200, 100, 200],
      // Los avisos de pedidos para el personal se quedan en pantalla hasta que los toquen.
      requireInteraction: !!datos.urgente,
      data: { pedidoId: datos.pedidoId, url: datos.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client && client.url.includes(url)) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    }),
  )
})

// Una version nueva de la app se activa apenas se instala (antes esperaba que la propia app se lo pidiera; si la app
// habia quedado en blanco no podia pedirlo y el telefono seguia con la copia vieja).
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Si el telefono guardo una copia danada de un archivo de la app (ej. se descargo justo mientras se publicaba una
// version nueva y llego una pagina en vez del archivo), se ignora esa copia y se baja el archivo bueno de internet.
// Este manejador va antes que el de workbox, asi que tiene prioridad para los archivos de /assets/.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/assets/')) return
  if (!/\.(js|css)$/.test(url.pathname)) return
  event.respondWith(
    (async () => {
      const guardado = await caches.match(req, { ignoreSearch: true })
      const tipo = guardado ? guardado.headers.get('content-type') || '' : ''
      if (guardado && !tipo.includes('text/html')) return guardado
      return fetch(req)
    })(),
  )
})
