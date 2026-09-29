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
      vibrate: [200, 100, 200],
      requireInteraction: false,
      data: { pedidoId: datos.pedidoId },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow('/')
    }),
  )
})
